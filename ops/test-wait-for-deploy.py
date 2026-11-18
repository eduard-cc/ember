#!/usr/bin/env python3
"""Deploy-wait decisions against a faked deploy state."""
import importlib.machinery
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

path = str(Path(__file__).with_name("wait-for-deploy"))
loader = importlib.machinery.SourceFileLoader("wait_for_deploy", path)
spec = importlib.util.spec_from_loader("wait_for_deploy", loader)
wfd = importlib.util.module_from_spec(spec)
loader.exec_module(wfd)

SHA, OLD, NEW = "a" * 40, "b" * 40, "c" * 40
# Ancestry: OLD < SHA < NEW
ANCESTORS = {(OLD, SHA), (SHA, NEW), (OLD, NEW)}


class Git:
    def __init__(self, args):
        self.args = args

    @property
    def returncode(self):
        a = self.args
        if a[0] == "merge-base":
            return 0 if (a[2], a[3]) in ANCESTORS else 1
        return 0

    @property
    def stdout(self):
        return SHA + "\n"


def run(states, timeout_min=40):
    seq = iter(states)
    with patch.object(wfd, "git", side_effect=lambda *a: Git(a)), \
         patch.object(wfd, "state", side_effect=lambda: next(seq)), \
         patch.object(wfd.time, "sleep"), \
         patch.object(sys, "argv", ["wait-for-deploy", SHA, "--timeout-min", str(timeout_min)]):
        return wfd.main()


def st(current, hold="", deployer="inactive", app="active"):
    return {"current": current, "hold": hold, "deployer": deployer, "app": app}


class WaitForDeployTest(unittest.TestCase):
    def test_waits_through_ci_and_deploy_then_succeeds(self):
        self.assertEqual(run([st(OLD, OLD), st(OLD, SHA, "active"), st(SHA, SHA, "active"), st(SHA, SHA)]), 0)

    def test_waits_while_the_deploy_restarts_the_switched_release(self):
        self.assertEqual(run([st(SHA, SHA, "active", app="activating"), st(SHA, SHA)]), 0)

    def test_newer_release_containing_commit_counts(self):
        self.assertEqual(run([st(NEW, NEW)]), 0)

    def test_held_commit_fails(self):
        self.assertEqual(run([st(OLD, OLD), st(OLD, SHA)]), 1)

    def test_rolled_back_newer_commit_fails(self):
        self.assertEqual(run([st(OLD, NEW)]), 1)

    def test_app_down_fails(self):
        self.assertEqual(run([st(SHA, SHA, app="failed")]), 1)

    def test_timeout(self):
        self.assertEqual(run([st(OLD, OLD)] * 3, timeout_min=-1), 2)


if __name__ == "__main__":
    unittest.main()
