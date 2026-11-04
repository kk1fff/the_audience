#!/usr/bin/env python3
"""Fixed-image tuning lifecycle. Python standard library + Docker Compose only."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[4]
ENV_KEYS = {'LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_THINK', 'EXA_API_KEY'}
PUBLIC_KEYS = ENV_KEYS - {'LLM_API_KEY', 'EXA_API_KEY'}
MARKER = 'audience-tuning-v1'


def run(args, **kwargs):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True, **kwargs)
    if result.returncode:
        # Docker errors can echo environment-file contents. Keep private stderr out of reports.
        raise RuntimeError(f'{args[0]} command failed (exit {result.returncode}); inspect locally, without publishing credentials')
    return result.stdout.strip()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def private_env(source, destination, allow_mock=False):
    values = {}
    for line in source.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, value = line.partition('=')
        if not sep or key not in ENV_KEYS:
            raise ValueError('Use plain KEY=value lines with supported LLM/Exa keys only')
        values[key] = value
    if values.get('LLM_PROVIDER') not in ({'ollama', 'openai_compatible', 'mock'} if allow_mock else {'ollama', 'openai_compatible'}):
        raise ValueError('Select ollama or openai_compatible; mock requires --allow-mock for workflow tests')
    if values['LLM_PROVIDER'] != 'mock' and not all(values.get(k) for k in ['LLM_BASE_URL', 'LLM_MODEL']):
        raise ValueError('LLM_BASE_URL and LLM_MODEL are required')
    destination.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
    destination.chmod(0o600)
    return {k:v for k,v in values.items() if k in PUBLIC_KEYS}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def image_config(image, data, env=None, command='config'):
    args = ['docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}',
            '--mount', f'type=bind,source={data.resolve()},target=/app/data',
            '-e', 'DATABASE_PATH=/app/data/social.sqlite', '-e', 'AGENTS_DIR=/app/agents',
            '--add-host', 'host.docker.internal:host-gateway', '-w', '/app/apps/worker']
    if env:
        args += ['--env-file', env]
    result = run(args + [image, 'node', '--import', 'tsx', 'src/tuning.ts', command], timeout=90)
    return json.loads(result)


def materialize(config, destination):
    destination.mkdir(parents=True, exist_ok=False)
    (destination/'prompts').mkdir()
    (destination/'prompts'/'behavior.md').write_text(config['behavior']+'\n')
    for agent in config['agents']:
        if not re.fullmatch('[a-z0-9_-]+', agent['id']):
            raise ValueError('Invalid agent ID in image configuration')
        folder = destination/'agents'/agent['id']
        folder.mkdir(parents=True)
        write_json(folder/'profile.json', agent['profile'])
        (folder/'memory.md').write_text(agent['memory']+'\n')


def config_hash(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def fixed_profiles(config):
    return {a['id']:{k:v for k,v in a['profile'].items() if k != 'persona'} for a in config['agents']}


def compose_document(image, data, env, port, project, deadline=None):
    shared = {'image':image, 'pull_policy':'never', 'user':f'{os.getuid()}:{os.getgid()}',
              'init':True, 'volumes':[{'type':'bind','source':str(data),'target':'/app/data'}]}
    common_env = {'DATABASE_PATH':'/app/data/social.sqlite', 'AGENTS_DIR':'/app/agents'}
    worker_env = {**common_env, 'BACKGROUND_PYTHON':'/opt/ddgs/bin/python'}
    if deadline:
        worker_env.update(TUNING_DEADLINE=deadline, TUNING_FAILURE_LIMIT='3')
    return {'name':project, 'services': {
        'web':{**shared, 'working_dir':'/app/apps/web',
               'command':['node','node_modules/next/dist/bin/next','start','--hostname','0.0.0.0'],
               'environment':common_env, 'ports':[f'127.0.0.1:{port}:3000']},
        'worker':{**shared, 'working_dir':'/app/apps/worker',
                  'command':['node','--import','tsx','src/index.ts'],
                  'environment':worker_env, 'env_file':[{'path':str(env),'format':'raw'}],
                  'extra_hosts':['host.docker.internal:host-gateway']}}}


def session(path, check_env=True):
    root = path.resolve()
    state = json.loads((root/'session.json').read_text())
    if state.get('format') != MARKER or state.get('root') != str(root):
        raise ValueError('Not an owned tuning session; refusing lifecycle operations')
    if check_env and digest(root/'private.env') != state['env_hash']:
        raise ValueError('LLM settings changed; create a new session for fair comparisons')
    return root, state


def save(root, state):
    write_json(root/'session.json', state)


def compose(root, *args):
    project=json.loads((root/'session.json').read_text())['project']
    return run(['docker','compose','-p',project,'-f',root/'compose.json',*args], timeout=120)


def api(root, state, route, body=None):
    req = urllib.request.Request(f'http://127.0.0.1:{state["port"]}{route}',
        data=None if body is None else json.dumps(body).encode(),
        headers={} if body is None else {'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def activity(root, state):
    items, cursor, seen = [], None, set()
    while True:
        page=api(root,state,'/api/activity'+('' if cursor is None else f'?beforePostId={cursor}'))
        items.extend(page['items'])
        cursor=page.get('nextCursor')
        if cursor is None:
            return items
        if cursor in seen:
            raise RuntimeError('Repeated activity cursor')
        seen.add(cursor)


def collect(root, state):
    if not state.get('current'):
        return
    folder=root/'trials'/state['current']
    rows=activity(root,state)
    conversations=[api(root,state,f'/api/posts/{post_id}') for post_id in sorted({j['postId'] for j in rows})]
    write_json(folder/'results.json', {'feed':api(root,state,'/api/posts'), 'conversations':conversations, 'activity':rows})


def stop(root, state):
    if not (root/'compose.json').exists():
        return
    compose(root,'stop','worker')
    try:
        collect(root,state)
    except (OSError, ValueError, RuntimeError):
        pass  # Trial data stays on disk even when the web service is unavailable.
    compose(root,'down')


def candidate(root, state):
    config=image_config(state['image'],root/'candidate')
    if state.get('fixed_profiles') is not None and fixed_profiles(config) != state['fixed_profiles']:
        raise ValueError('Roster, identities, location, or schedules changed; only persona/memory/behavior may change after baseline')
    if not any(a['profile'].get('enabled',True) for a in config['agents']):
        raise ValueError('At least one enabled agent is required')
    return config


def deadline(state):
    if not state.get('deadline'):
        state['deadline']=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=state['minutes'])).isoformat()
    if dt.datetime.fromisoformat(state['deadline']).timestamp() <= time.time():
        raise ValueError('Session deadline reached; preserve results and ask the user before starting a new session')
    return state['deadline']


def initialize(args):
    root=args.session.resolve()
    if root.exists():
        raise ValueError('Session destination already exists; choose a new empty location')
    image=run(['docker','image','inspect','--format','{{.Id}}',args.image])
    if not re.fullmatch('sha256:[a-f0-9]{64}',image):
        raise ValueError('Expected a local Docker image ID')
    root.mkdir(parents=True)
    try:
        settings=private_env(args.env_file,root/'private.env',args.allow_mock)
        empty=root/'bootstrap';empty.mkdir()
        config=image_config(image,empty)
        if config.get('version') != 1:
            raise ValueError('Image does not support tuning configuration version 1')
        materialize(config,root/'candidate')
        state={'format':MARKER,'root':str(root),'image':image,'port':args.port,
               'project':'audience-tune-'+uuid.uuid4().hex[:12], 'minutes':args.minutes,
               'max_rounds':args.rounds,'rounds':0,'model':settings,'env_hash':digest(root/'private.env'),
               'probe_ok':settings['LLM_PROVIDER']=='mock','workflow_test':settings['LLM_PROVIDER']=='mock'}
        save(root,state)
        print(json.dumps({'session':str(root),'image':image,'workflow_test':state['workflow_test']}))
    except Exception:
        # Do not delete an unknown directory; leave failed initialization inspectable.
        raise


def trial(args, root, state):
    if not re.fullmatch('[a-z0-9_-]+',args.name):
        raise ValueError('Trial names use lowercase letters, digits, underscores and hyphens')
    if not state['probe_ok']:
        raise ValueError('Run probe before starting real-LLM trials')
    config=candidate(root,state)
    until=deadline(state)
    folder=root/'trials'/args.name
    if folder.exists():
        raise ValueError('Trial already exists; choose a new name to preserve evidence')
    if state.get('fixed_profiles') is None:
        if args.manual:
            raise ValueError('Record a baseline before a manual trial')
        state['fixed_profiles']=fixed_profiles(config)
    elif not args.manual:
        if state['rounds'] >= state['max_rounds']:
            raise ValueError('Candidate round limit reached')
        state['rounds']+=1
    stop(root,state)
    folder.mkdir(parents=True)
    materialize(config,folder/'data')
    write_json(folder/'configuration.json',config)
    write_json(folder/'trial.json',{'manual':args.manual,'prompt_hash':config_hash(config),'image':state['image'],'model':state['model']})
    state['current']=args.name
    write_json(root/'compose.json',compose_document(state['image'],folder/'data',root/'private.env',state['port'],state['project'],until))
    save(root,state)
    try:
        compose(root,'up','-d')
    except Exception:
        compose(root,'stop','worker')
        raise
    for _ in range(60):
        try:
            if api(root,state,'/api/agents'):
                print(f'Trial {args.name}: http://localhost:{state["port"]}')
                return
        except (OSError,ValueError):
            pass
        time.sleep(.5)
    compose(root,'stop','worker')
    raise RuntimeError('Application startup failed; worker stopped, inspect session logs')


def observe(args, root, state):
    end=min(time.time()+args.timeout,dt.datetime.fromisoformat(state['deadline']).timestamp())
    stable_since=None
    previous=None
    while time.time()<end:
        rows=[j for j in activity(root,state) if j['postId']==args.post_id]
        fingerprint=json.dumps([(j['id'],j['status'],j.get('outcome')) for j in rows])
        pending=any(j['status'] in ('pending','running') for j in rows)
        if rows and not pending and fingerprint==previous:
            stable_since=stable_since or time.time()
            if time.time()-stable_since>=args.quiet:
                collect(root,state)
                print(json.dumps({'settled':True,'post_id':args.post_id,'outcomes':[j.get('outcome') or j['status'] for j in rows]}))
                return
        else:
            stable_since=None
        previous=fingerprint
        time.sleep(min(2,max(0,end-time.time())))
    collect(root,state)
    print(json.dumps({'settled':False,'post_id':args.post_id,'reason':'observation timeout or session deadline; not a personality verdict'}))


def export(args, root, state):
    if not args.accepted:
        raise ValueError('Export requires --accepted after user acceptance; do not infer acceptance')
    config=candidate(root,state)
    if not state.get('current'):
        raise ValueError('Run and evaluate a trial first')
    tested=json.loads((root/'trials'/state['current']/'configuration.json').read_text())
    if config_hash(config)!=config_hash(tested):
        raise ValueError('Candidate differs from last tested trial; test it before export')
    target=args.output.resolve()
    if target.exists():
        raise ValueError('Export destination exists; ask the user for a new destination')
    target.parent.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='.audience-export-',dir=target.parent))
    try:
        materialize(config,stage/'local_data')
        shutil.copyfile(root/'private.env',stage/'local_runtime.env');(stage/'local_runtime.env').chmod(0o600)
        project='audience-local-'+uuid.uuid4().hex[:8]
        launch=f'docker compose -p {project} -f compose.local.yaml up -d'
        write_json(stage/'compose.local.yaml',compose_document(state['image'],'./local_data','./local_runtime.env',args.port,project))
        # Smoke against a disposable copy, never pollute the delivered folder with runtime state.
        with tempfile.TemporaryDirectory(prefix='audience-export-check-') as tmp:
            check=Path(tmp);shutil.copytree(stage/'local_data',check/'data')
            doc=compose_document(state['image'],check/'data',root/'private.env',args.port,'audience-check-'+uuid.uuid4().hex[:8])
            doc['services']['web'].pop('ports')
            doc['services'].pop('worker')  # No live LLM spend during export smoke.
            write_json(check/'compose.json',doc)
            cmd=['docker','compose','-p',doc['name'],'-f',check/'compose.json']
            try:
                run(cmd+['up','-d'],timeout=120)
                run(cmd+['exec','-T','-w','/app/apps/worker','web','node','--import','tsx','--input-type=module','-e',"import {syncAgents} from '@social/db'; import {loadBehaviorPrompt} from '@social/llm'; loadBehaviorPrompt();syncAgents();"],timeout=60)
                run(cmd+['exec','-T','web','node','-e',"(async()=>{for(let i=0;i<30;i++){try{const r=await fetch('http://localhost:3000/api/agents');if(r.ok&&(await r.json()).length)return;}catch{}await new Promise(r=>setTimeout(r,500));}process.exitCode=1;})()"],timeout=30)
            finally:
                run(cmd+['down'],timeout=60)
        write_json(stage/'manifest.json',{'image':state['image'],'model':state['model'],'prompt_hash':config_hash(config),'workflow_test':state['workflow_test'],'verified_startup':True})
        report=root/'report.md'
        if not report.exists():
            raise ValueError('Write session report.md with personality briefs, evidence, limitations and acceptance before export')
        report_text=report.read_text()
        for line in (root/'private.env').read_text().splitlines():
            key,_,value=line.partition('=')
            if key in ('LLM_API_KEY','EXA_API_KEY') and value and value in report_text:
                raise ValueError('Report contains a configured secret; remove it before export')
        shutil.copyfile(report,stage/'report.md')
        (stage/'RUN.md').write_text('From this directory:\n\n```sh\n'+launch+'\n```\n\nOpen http://localhost:'+str(args.port)+'. Keep local_runtime.env private. The image is pinned by ID and must exist locally; on another machine load that same image and provide a reachable LLM endpoint.\n')
        stage.rename(target)
        print(f'Export: {target}\ncd {target}\n{launch}')
    finally:
        if stage.exists():
            shutil.rmtree(stage)  # Only the temporary directory created above.


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    build=sub.add_parser('build');build.add_argument('--tag',default='audience:tuning')
    init=sub.add_parser('init');init.add_argument('--session',type=Path,required=True);init.add_argument('--image',required=True);init.add_argument('--env-file',type=Path,required=True);init.add_argument('--port',type=int,default=3002);init.add_argument('--minutes',type=int,default=30);init.add_argument('--rounds',type=int,default=3);init.add_argument('--allow-mock',action='store_true')
    commands={}
    for name in ['probe','trial','reload','start','stop','collect','observe','export','post','reply','status']:
        p=sub.add_parser(name);p.add_argument('--session',type=Path,required=True);commands[name]=p
    commands['trial'].add_argument('--name',required=True);commands['trial'].add_argument('--manual',action='store_true')
    commands['observe'].add_argument('--post-id',type=int,required=True);commands['observe'].add_argument('--timeout',type=int,default=360);commands['observe'].add_argument('--quiet',type=int,default=10)
    commands['export'].add_argument('--output',type=Path,required=True);commands['export'].add_argument('--port',type=int,default=3000);commands['export'].add_argument('--accepted',action='store_true')
    for name in ['post','reply']:
        commands[name].add_argument('--text',required=True)
    commands['reply'].add_argument('--parent-id',type=int,required=True)
    args=parser.parse_args()
    if args.command=='build':
        print(run(['docker','build','--target','production','-t',args.tag,ROOT],timeout=1200));return
    if args.command=='init':
        if not 1<=args.minutes<=1440 or not 1<=args.rounds<=20 or not 1024<=args.port<=65535:
            raise ValueError('Use 1–1440 minutes, 1–20 rounds and port 1024–65535')
        initialize(args);return
    root,state=session(args.session,check_env=args.command not in ('stop','collect','status'))
    if args.command=='probe':
        until=deadline(state);save(root,state)
        result=image_config(state['image'],root/'candidate',root/'private.env','probe')
        state['probe_ok']=True;state['probe']=result;save(root,state);print(json.dumps(result))
    elif args.command=='trial': trial(args,root,state)
    elif args.command in ('start','reload'):
        deadline(state)
        config=candidate(root,state)
        if not state.get('current'): raise ValueError('Create a trial first')
        recorded=json.loads((root/'trials'/state['current']/'configuration.json').read_text())
        if config_hash(config)!=config_hash(recorded): raise ValueError('Candidate changed; create a fresh trial for comparable starting memories')
        compose(root,'up','-d') if args.command=='start' else compose(root,'restart','worker')
    elif args.command=='stop': stop(root,state)
    elif args.command=='collect': collect(root,state)
    elif args.command=='observe': observe(args,root,state)
    elif args.command=='export': export(args,root,state)
    elif args.command=='status': print(json.dumps(state,indent=2))
    else:
        deadline(state)
        body={'text':args.text}
        if args.command=='reply': body['parentId']=args.parent_id
        print(json.dumps(api(root,state,'/api/posts' if args.command=='post' else '/api/comments',body)))

if __name__=='__main__':
    try: main()
    except (ValueError,RuntimeError,OSError,subprocess.TimeoutExpired) as error:
        print(f'Error: {error}',file=sys.stderr);sys.exit(1)
