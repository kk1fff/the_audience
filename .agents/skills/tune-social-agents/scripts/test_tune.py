import argparse
import contextlib
import io
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('tune',Path(__file__).with_name('tune.py'))
tune=importlib.util.module_from_spec(spec);spec.loader.exec_module(tune)
CONFIG={'version':1,'behavior':'Respect different voices','agents':[
    {'id':'aya','profile':{'name':'Aya','handle':'aya','persona':'Curious','enabled':True},'memory':'Seed'},
    {'id':'leo','profile':{'name':'Leo','handle':'leo','persona':'Concise','enabled':False},'memory':''}]}

class TuningTests(unittest.TestCase):
    def test_materialization_excludes_runtime_and_preserves_distinct_disabled_profiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'local_data';tune.materialize(CONFIG,output)
            files={str(p.relative_to(output)) for p in output.rglob('*') if p.is_file()}
            self.assertEqual(files,{'prompts/behavior.md','agents/aya/profile.json','agents/aya/memory.md','agents/leo/profile.json','agents/leo/memory.md'})
            self.assertFalse(json.loads((output/'agents/leo/profile.json').read_text())['enabled'])
            self.assertEqual((output/'agents/aya/memory.md').read_text(),'Seed\n')
            with self.assertRaises(FileExistsError):tune.materialize(CONFIG,output)

    def test_secrets_and_model_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'input';dest=Path(tmp)/'private.env'
            source.write_text('LLM_PROVIDER=openai_compatible\nLLM_MODEL=example\nLLM_BASE_URL=http://host/v1\nLLM_API_KEY=literal$secret#value\n')
            public=tune.private_env(source,dest)
            self.assertNotIn('LLM_API_KEY',public)
            self.assertIn('literal$secret#value',dest.read_text())
            self.assertEqual(dest.stat().st_mode&0o777,0o600)
            source.write_text('LLM_PROVIDER=mock\n')
            with self.assertRaises(ValueError):tune.private_env(source,dest)
            tune.private_env(source,dest,True)
            source.write_text('DATABASE_PATH=/production\n')
            with self.assertRaises(ValueError):tune.private_env(source,dest)

    def test_configuration_lock_allows_only_individual_persona_and_seed_changes(self):
        changed=copy.deepcopy(CONFIG);changed['agents'][0]['profile']['persona']='Observant';changed['agents'][0]['memory']='New seed'
        self.assertEqual(tune.fixed_profiles(CONFIG),tune.fixed_profiles(changed))
        self.assertNotEqual(tune.config_hash(CONFIG),tune.config_hash(changed))
        changed['agents'][0]['profile']['enabled']=False
        self.assertNotEqual(tune.fixed_profiles(CONFIG),tune.fixed_profiles(changed))

    def test_compose_pins_image_and_data_without_sources_and_export_has_no_deadline(self):
        doc=tune.compose_document('sha256:abc','/isolated/data','/private.env',3002,'test','2030-01-01')
        self.assertEqual(doc['services']['web']['volumes'][0]['source'],'/isolated/data')
        self.assertEqual(doc['services']['worker']['pull_policy'],'never')
        self.assertEqual(doc['services']['worker']['environment']['TUNING_DEADLINE'],'2030-01-01')
        self.assertNotIn('build',doc['services']['web'])
        export=tune.compose_document('sha256:abc','./local_data','./local_runtime.env',3000,'final')
        self.assertNotIn('TUNING_DEADLINE',export['services']['worker']['environment'])
        self.assertEqual(export['services']['worker']['env_file'][0]['format'],'raw')

    def test_activity_paginates_and_detects_broken_cursors(self):
        with patch.object(tune,'api',side_effect=[{'items':[{'id':2}],'nextCursor':2},{'items':[{'id':1}],'nextCursor':None}]) as call:
            self.assertEqual(tune.activity(None,{}),[{'id':2},{'id':1}])
            self.assertEqual(call.call_args.args[2],'/api/activity?beforePostId=2')
        with patch.object(tune,'api',return_value={'items':[],'nextCursor':2}):
            with self.assertRaises(RuntimeError):tune.activity(None,{})

    def test_lifecycle_requires_owned_session_and_unchanged_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();env=root/'private.env';env.write_text('LLM_PROVIDER=mock\n')
            state={'format':tune.MARKER,'root':str(root),'env_hash':tune.digest(env)}
            tune.save(root,state);self.assertEqual(tune.session(root)[1],state)
            env.write_text('LLM_PROVIDER=ollama\n')
            with self.assertRaises(ValueError):tune.session(root)
            state['format']='unknown';tune.save(root,state)
            with self.assertRaises(ValueError):tune.session(root)

    def test_trials_start_clean_and_enforce_rounds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'private.env').write_text('LLM_PROVIDER=mock\n')
            state={'probe_ok':True,'image':'sha256:fake','port':3002,'project':'test','model':{},'minutes':30,'rounds':0,'max_rounds':1}
            args=argparse.Namespace(name='baseline',manual=False)
            with patch.object(tune,'candidate',return_value=CONFIG),patch.object(tune,'compose'),patch.object(tune,'api',return_value=[{'id':'aya'}]),patch.object(tune,'collect'),contextlib.redirect_stdout(io.StringIO()):
                tune.trial(args,root,state)
                (root/'trials/baseline/data/social.sqlite').write_text('learned history')
                args.name='candidate';tune.trial(args,root,state)
                self.assertFalse((root/'trials/candidate/data/social.sqlite').exists())
                self.assertEqual((root/'trials/candidate/data/agents/aya/memory.md').read_text(),'Seed\n')
                args.name='over-budget'
                with self.assertRaises(ValueError):tune.trial(args,root,state)

    def test_export_is_clean_and_refuses_overwrite_or_untested_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'session';root.mkdir();(root/'private.env').write_text('LLM_PROVIDER=mock\nLLM_API_KEY=secret-value\n')
            trial=root/'trials/baseline';trial.mkdir(parents=True)
            tune.write_json(trial/'configuration.json',CONFIG)
            (root/'report.md').write_text('Aya is curious; Leo is concise. Workflow test, no behavioral claim.')
            state={'current':'baseline','image':'sha256:fake','model':{'LLM_PROVIDER':'mock'},'workflow_test':True}
            args=argparse.Namespace(accepted=True,output=Path(tmp)/'export',port=3000)
            with patch.object(tune,'candidate',return_value=CONFIG),patch.object(tune,'run',return_value=''),contextlib.redirect_stdout(io.StringIO()):
                tune.export(args,root,state)
                self.assertFalse((args.output/'local_data/social.sqlite').exists())
                self.assertFalse((args.output/'local_data/local_runtime.env').exists())
                self.assertNotIn('secret-value',(args.output/'manifest.json').read_text())
                self.assertEqual((args.output/'local_runtime.env').stat().st_mode&0o777,0o600)
                with self.assertRaises(ValueError):tune.export(args,root,state)
            changed=copy.deepcopy(CONFIG);changed['behavior']='Untested'
            args.output=Path(tmp)/'another'
            with patch.object(tune,'candidate',return_value=changed):
                with self.assertRaises(ValueError):tune.export(args,root,state)
            (root/'report.md').write_text('Accidental secret-value')
            with patch.object(tune,'candidate',return_value=CONFIG),patch.object(tune,'run',return_value=''):
                with self.assertRaisesRegex(ValueError,'configured secret'):tune.export(args,root,state)
            self.assertFalse(args.output.exists())

    def test_observation_timeout_preserves_partial_results(self):
        args=argparse.Namespace(timeout=1,post_id=9,quiet=10)
        state={'deadline':'2000-01-01T00:00:00+00:00'}
        output=io.StringIO()
        with patch.object(tune,'collect') as collect,contextlib.redirect_stdout(output):
            tune.observe(args,None,state)
        collect.assert_called_once()
        self.assertFalse(json.loads(output.getvalue())['settled'])

if __name__=='__main__':unittest.main()
