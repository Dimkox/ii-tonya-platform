import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from engine import Engine, normalize, valid_vector, semantic_hit


class MatcherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(Path("packages/db/src/residency-hashtags.json").read_text())
        for row in cls.catalog:
            if row["tagValue"] == "тревожность":
                row["synonyms"].append({"term": "тревога"})
        cls.engine = Engine(os.environ["SEMANTIC_MODEL_PATH"])
        cls.cache = cls.engine.prepare(cls.catalog)

    def matches(self, text):
        return self.engine.recommend(text, self.cache)

    def test_exact_synonyms_and_morphology(self):
        for text, expected in [
            ("КПТ", "#КПТ"),
            ("ПА", "#панические_атаки"),
            ("паника", "#панические_атаки"),
            ("работаю с тревогой", "#тревожность"),
        ]:
            with self.subTest(text=text):
                self.assertTrue(any(r["label"] == expected and r["score"] == 100 for r in self.matches(text)))

    def test_unicode_normalization(self):
        self.assertEqual(normalize(" #ПОРТРЕТНАЯ_СЪЁМКА "), "портретная съемка")

    def test_no_substring_or_negation(self):
        self.assertFalse(any(r["label"] == "#панические_атаки" for r in self.matches("лопата")))
        self.assertEqual(self.matches("не работаю с паникой"), [])

    def test_unknown_qualifier_does_not_collapse(self):
        self.assertEqual(self.matches("гиперсверх йога"), [])

    def test_real_semantic_full_coverage(self):
        for text, expected in [
            ("невысокая самооценка", "#низкая_самооценка"),
            ("проблемы в отношениях", "#парная_терапия"),
        ]:
            with self.subTest(text=text):
                self.assertTrue(
                    any(
                        r["label"] == expected and r["score"] == 50 and 0.85 < r["cosine"] <= 1
                        for r in self.matches(text)
                    )
                )

    def test_vectors_and_cache(self):
        self.assertFalse(valid_vector([0.0] * 300))
        self.assertFalse(valid_vector([float("nan")] * 300))
        self.assertFalse(valid_vector([1.0]))
        self.assertTrue(len(self.cache["vectors"]) > 600)
        self.assertTrue(all(valid_vector(row["vector"]) for row in self.cache["vectors"]))
        corrupt = dict(self.cache, generation="bad")
        with self.assertRaises(ValueError):
            self.engine.recommend("паника", corrupt)

    def test_limit_and_determinism(self):
        text = "; ".join(r["tagValue"] for r in self.catalog[:30])
        results = self.matches(text)
        self.assertEqual(len(results), 15)
        self.assertEqual(len(set(r["id"] for r in results)), 15)
        self.assertEqual(results, self.matches(text))

    def test_strict_threshold(self):
        self.assertFalse(semantic_hit(0.85))
        self.assertFalse(semantic_hit(float("nan")))
        self.assertFalse(semantic_hit(0))
        self.assertTrue(semantic_hit(0.850001))

    def test_input_bound(self):
        with self.assertRaises(ValueError):
            self.matches("я" * 16001)

    def test_private_text_not_cached(self):
        before = json.dumps(self.cache, sort_keys=True)
        self.matches("невысокая самооценка")
        self.assertEqual(json.dumps(self.cache, sort_keys=True), before)


if __name__ == "__main__":
    unittest.main()
