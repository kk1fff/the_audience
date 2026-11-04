#!/usr/bin/env python3
"""Optional Docker integration check using a local HTTP fixture, never a real LLM.
Build the tuning image first, then run with --image and an unused --port.
"""
import argparse
import datetime as dt, http.server, json, pathlib, socketserver, subprocess, tempfile, threading, time

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image",default="audience:tuning")
    parser.add_argument("--port",type=int,default=3014)
    args=parser.parse_args()
    root=pathlib.Path(tempfile.mkdtemp(prefix='audience-runtime-check-'))
    helper=pathlib.Path(__file__).with_name('tune.py').resolve()
    mode='invalid'
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            if mode=='error':
                self.send_response(503);self.end_headers();return
            content='{}' if mode=='invalid' else json.dumps({'like':False,'comment':'Fixture acknowledgment','memory':None,'memoryEvaluation':None,'follow':False})
            payload=json.dumps({'model':'fixture-model','choices':[{'message':{'content':content}}]}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(payload)
        def log_message(self,*args): pass
    server=socketserver.TCPServer(('0.0.0.0',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    env=root/'llm.env';env.write_text(f'LLM_PROVIDER=openai_compatible\nLLM_BASE_URL=http://host.docker.internal:{server.server_address[1]}/v1\nLLM_MODEL=fixture-model\n')
    session=root/'session'
    def cli(*args,ok=True):
        result=subprocess.run(['python3',str(helper),*map(str,args)],capture_output=True,text=True,timeout=120)
        if ok and result.returncode: raise AssertionError(result.stderr)
        return result
    try:
        cli('init','--session',session,'--image',args.image,'--env-file',env,'--port',args.port,'--minutes',3)
        for profile in (session/'candidate/agents').glob('*/profile.json'):
            value=json.loads(profile.read_text());value['enabled']=profile.parent.name=='aya';profile.write_text(json.dumps(value))
        assert cli('probe','--session',session,ok=False).returncode!=0
        assert not json.loads((session/'session.json').read_text())['probe_ok']
        mode='valid';assert json.loads(cli('probe','--session',session).stdout)['valid']
        cli('trial','--session',session,'--name','baseline')
        mode='error';cli('post','--session',session,'--text','@aya_wanders test delivery')
        project=json.loads((session/'session.json').read_text())['project']
        name=f'{project}-worker-1'
        stopped=False
        for _ in range(80):
            state=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .State}}',name],text=True))
            if state['Status']=='exited':
                assert state['ExitCode']==1;stopped=True;break
            time.sleep(1)
        assert stopped,'Worker failed to stop after repeated provider errors'
        logs=subprocess.check_output(['docker','logs',name],stderr=subprocess.STDOUT,text=True)
        assert 'Tuning stopped after repeated failures' in logs
        cli('collect','--session',session)
        rows=json.loads((session/'trials/baseline/results.json').read_text())['activity']
        assert any(len(row['attemptHistory'])>=3 for row in rows)
        # Runtime deadline is enforced even with no host helper supervising it.
        data=root/'deadline-data';data.mkdir()
        deadline=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=3)).isoformat()
        result=subprocess.run(['docker','run','--rm','-v',f'{data}:/app/data','-e',f'TUNING_DEADLINE={deadline}','-e','LLM_PROVIDER=mock','-e','DATABASE_PATH=/app/data/social.sqlite','-w','/app/apps/worker',args.image,'node','--import','tsx','src/index.ts'],capture_output=True,text=True,timeout=15)
        assert result.returncode==0 and 'Tuning deadline reached' in result.stdout
        print(json.dumps({'result':'passed','evidence':str(root),'checks':['invalid provider schema rejected','valid schema probe succeeds','worker stops after three consecutive provider errors','activity retains failed attempts','deadline stops unattended worker']}))
    finally:
        if (session/'session.json').exists():cli('stop','--session',session,ok=False)
        server.shutdown();server.server_close()

if __name__=="__main__": main()
