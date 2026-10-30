"""Extend only Getzilla's single hosted full-suite timeout, never retry a test."""


def install_ci_test_timeout(verification):
    original = verification._command_check

    def bounded(root, name, command, timeout=300, *, env=None):
        if name == 'pnpm-test' and command == ['pnpm', 'run', 'test']:
            timeout = max(timeout, 3600)
        return original(root, name, command, timeout, env=env)

    verification._command_check = bounded
