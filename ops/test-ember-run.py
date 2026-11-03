#!/usr/bin/env python3
"""The admin entry stays local and drops privilege inside the protected namespace."""
import importlib.machinery
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

path = Path(__file__).with_name('host') / 'ember-run'
loader = importlib.machinery.SourceFileLoader('ember_entry', str(path))
spec = importlib.util.spec_from_loader(loader.name, loader)
assert spec is not None
entry = importlib.util.module_from_spec(spec)
loader.exec_module(entry)


class EntryTests(unittest.TestCase):
    def invoke(self, argv, *, uid=0, pids=('765', '765'), account_uid=1234, namespace_checks=(True, False)):
        account = SimpleNamespace(pw_uid=account_uid, pw_gid=1234, pw_dir='/home/ember')
        with patch.object(entry.os, 'geteuid', return_value=uid), \
             patch.object(entry.pwd, 'getpwnam', return_value=account) as lookup, \
             patch.object(entry.subprocess, 'check_output', side_effect=pids), \
             patch.object(entry.os, 'open', return_value=18) as opened, \
             patch.object(entry.fcntl, 'ioctl', return_value=19), \
             patch.object(entry.os.path, 'samefile', side_effect=namespace_checks), \
             patch.object(entry.os, 'close'), \
             patch.object(entry.os, 'set_inheritable') as inherited, \
             patch.object(entry.os, 'execv') as executed:
            entry.main(argv)
            return lookup, opened, inherited, executed

    def test_command_runs_as_ember_after_entering_its_pinned_namespace(self):
        args = ['--unit=entry-test', '--slice=ember-jobs.slice', '--', '/bin/echo', 'literal ; $HOME']
        lookup, opened, inherited, executed = self.invoke(args)
        lookup.assert_called_once_with('ember')
        opened.assert_called_once_with('/proc/765/ns/mnt', entry.os.O_RDONLY)
        inherited.assert_called_once_with(18, True)
        command = executed.call_args.args[1]
        self.assertEqual(command[:3], ['/usr/bin/nsenter', '--mount=/proc/self/fd/18', '--wd=/home/ember'])
        self.assertEqual(command[3:9], ['/usr/bin/setpriv', '--reuid=1234', '--regid=1234', '--clear-groups', '--reset-env', '/usr/bin/env'])
        self.assertIn('XDG_RUNTIME_DIR=/run/user/1234', command)
        self.assertIn('DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1234/bus', command)
        self.assertEqual(command[-len(args):], args)
        self.assertLess(command.index('/usr/bin/setpriv'), command.index('/usr/bin/systemd-run'))
        self.assertIn('--user', command)

    def test_namespace_is_private_and_owned_by_the_root_user_namespace(self):
        for checks in [(False,), (True, True)]:
            with self.subTest(checks=checks), self.assertRaises(RuntimeError):
                self.invoke(['--', '/bin/true'], namespace_checks=checks)

    def test_nonroot_caller_is_refused(self):
        with self.assertRaises(PermissionError):
            self.invoke(['--', '/bin/true'], uid=1234)

    def test_root_identity_is_not_a_service_target(self):
        with self.assertRaises(RuntimeError):
            self.invoke(['--', '/bin/true'], account_uid=0)

    def test_missing_or_changed_manager_is_refused(self):
        for pids in [('0',), ('765', '766')]:
            with self.subTest(pids=pids), self.assertRaises(RuntimeError):
                self.invoke(['--', '/bin/true'], pids=pids)

    def test_remote_or_system_bus_options_are_refused(self):
        for option in ['-M', '--machine=ember@', '--host=other', '--system', '--property=User=root']:
            with self.subTest(option=option), self.assertRaises(ValueError):
                self.invoke([option, '--', '/bin/true'])

    def test_command_separator_and_command_are_required(self):
        for args in ([], ['/bin/true'], ['--']):
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.invoke(args)


if __name__ == '__main__':
    unittest.main()
