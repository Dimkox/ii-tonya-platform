"""Local-only, request-ephemeral Russian matching. Public catalogue is the sole cache."""
import hashlib
import json
import math
import os
import re
import unicodedata
from pathlib import Path
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
import numpy as np
import pymorphy3
from navec import Navec
from razdel import tokenize

MODEL_SHA = 'f07270833d78523edc5781538d67038e95b43975e4a7ae757c693b687f9cbfca'
NORMALIZATION = 'ru-nfkc-yo-word-coverage-negation-v1'
RUNTIME = 'navec0.10.0-numpy2.5.4-pymorphy3-2.0.6-dicts2.4.417150.4580142-razdel0.5.0'
NEGATION = {'не', 'нет', 'без', 'никогда', 'ни', 'исключая', 'кроме'}

def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC', value).lower().replace('ё', 'е').replace('#', ' ').replace('_', ' ').split())

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

def semantic_hit(cosine):
    return math.isfinite(cosine) and .85 < cosine <= 1.000001

def valid_vector(v):
    return isinstance(v, list) and len(v) == 300 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v) and abs(sum(x*x for x in v) - 1) < .0001

class Engine:
    def __init__(self, path):
        from importlib.metadata import version, distribution
        expected = {'navec':'0.10.0','numpy':'2.5.4','pymorphy3':'2.0.6','pymorphy3-dicts-ru':'2.4.417150.4580142','razdel':'0.5.0'}
        if any(version(k) != v for k,v in expected.items()): raise ValueError('runtime_version_mismatch')
        assets = json.loads(Path(__file__).with_name('assets.json').read_text())
        for name, entry in assets.items():
            installed = distribution(name)
            for relative, expected_sha in entry['files'].items():
                with open(installed.locate_file(relative), 'rb') as asset:
                    actual = hashlib.file_digest(asset, 'sha256').hexdigest()
                if actual != expected_sha: raise ValueError('runtime_asset_mismatch')
        # Verify bytes before parsing the archive; no implicit downloader exists.
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != MODEL_SHA:
            raise ValueError('model_digest_mismatch')
        self.model = Navec.load(path)
        self.morph = pymorphy3.MorphAnalyzer()
        self.public_generation = None
        self.public_cache = None
        self.public_matrix = None
        self.public_rows = None
        self.model_identity = digest({'model': MODEL_SHA, 'runtime': RUNTIME, 'assets': digest(assets), 'normalization': NORMALIZATION, 'engine': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})

    def words(self, value):
        return [normalize(t.text) for t in tokenize(normalize(value)) if any(c.isalpha() for c in t.text)]

    def lemmas(self, words):
        # Deliberately no lru_cache: private vocabulary dies with each request.
        return [normalize(self.morph.parse(w)[0].normal_form) for w in words]

    def vector(self, words, lemmas):
        if not words or len(words) > 40: return None
        vectors = []
        for word, lemma in zip(words, lemmas):
            if word in self.model: vectors.append(self.model[word])
            elif lemma in self.model: vectors.append(self.model[lemma])
            else: return None  # Every meaningful qualifier must be represented.
        v = np.mean(vectors, axis=0)
        norm = float(np.linalg.norm(v))
        if not math.isfinite(norm) or norm <= 0: return None
        result = (v / norm).tolist()
        return result if valid_vector(result) else None

    def prepare(self, catalog):
        if not isinstance(catalog, list) or not 1 <= len(catalog) <= 512: raise ValueError('catalogue_bound')
        rows, vectors = [], []
        for t in sorted(catalog, key=lambda t: t['id']):
            if not t.get('isActive', True): continue
            terms = [t['tagValue'], *[s['term'] for s in t['synonyms']]]
            if len(terms) > 32: raise ValueError('synonym_bound')
            for term in terms:
                if len(term) > 160: raise ValueError('term_bound')
                words = self.words(term)
                lemmas = self.lemmas(words)
                row = {'id': t['id'], 'label': t['displayLabel'], 'weight': t['weightScore'], 'term': term, 'words': words, 'lemmas': lemmas}
                rows.append(row)
                v = self.vector(words, lemmas)
                if v is not None: vectors.append(dict(row, vector=v))
        cache = {'model': self.model_identity, 'taxonomy': digest(catalog), 'rows': rows, 'vectors': vectors}
        cache['generation'] = digest(cache)
        return cache

    def load(self, cache):
        if cache is self.public_cache: return
        if cache.get('model') != self.model_identity or cache.get('generation') != digest({k: v for k, v in cache.items() if k != 'generation'}): raise ValueError('cache_identity')
        if len(cache['vectors']) > 16384 or not all(valid_vector(r['vector']) for r in cache['vectors']): raise ValueError('cache_vector')
        if cache['generation'] != self.public_generation:
            matrix = np.array([r['vector'] for r in cache['vectors']], dtype=np.float64)
            self.public_matrix, self.public_rows, self.public_generation = matrix, cache['vectors'], cache['generation']
        self.public_cache = cache

    def recommend(self, text, cache):
        if not isinstance(text, str) or len(text) > 16000: raise ValueError('input_bound')
        self.load(cache)
        candidates = {}
        def add(row, score, cosine=None):
            old = candidates.get(row['id'])
            if old is None or old['score'] < score:
                candidates[row['id']] = {'id': row['id'], 'label': row['label'], 'score': score, 'weight': row['weight'], 'evidence': row['term'], 'cosine': cosine}
        chunks = re.split(r'[;\n.!?]+', text)
        if len(chunks) > 128: raise ValueError('segment_bound')
        budget = 0
        for chunk in chunks:
            words = self.words(chunk)
            budget += len(words)
            if budget > 512: raise ValueError('token_bound')
            if not words or len(words) > 40 or any(w in NEGATION for w in words): continue
            if all(any(feature in self.morph.parse(w)[0].tag for feature in ('Name', 'Surn', 'Patr', 'Geox')) for w in words): continue
            lemmas = self.lemmas(words)
            vector = self.vector(words, lemmas)
            # Exact short acronyms can be OOV, but an unknown qualifier must never
            # allow a known inner noun to impersonate a covered phrase.
            whole_exact = any(words == r['words'] or lemmas == r['lemmas'] for r in cache['rows'])
            if vector is None and not whole_exact: continue
            for row in cache['rows']:
                width = len(row['words'])
                if width and any(words[i:i+width] == row['words'] or lemmas[i:i+width] == row['lemmas'] for i in range(len(words)-width+1)):
                    add(row, 100)
            if vector is not None and len(self.public_rows):
                scores = self.public_matrix @ np.array(vector)
                for i in np.flatnonzero(scores > .85):
                    if semantic_hit(float(scores[i])): add(self.public_rows[i], 50, min(1., float(scores[i])))
        return sorted(candidates.values(), key=lambda r: (-r['score'], -r['weight'], r['id']))[:15]
