"""Enable a reviewed capacity API without replacing the existing web/Writer release.

Only standby-read code/environment and the existing config's API release field change.
Private rollback files and a public-data-only verification receipt stay in .runtime.
No IAM, source/cache, paid routing, frontend assets or protected functions are changed.
"""
import argparse, base64, hashlib, json, pathlib, subprocess, time, urllib.error, urllib.request, zipfile
import boto3

URL = 'https://d34x1513u5u1qs.cloudfront.net'
FUNCTION = 'standby-read'
ACCOUNT = '308857099262'

def fetch(path, payload=None, allowed=(200,)):
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(URL+path, data=body, headers={'Content-Type':'application/json', 'Cache-Control':'no-cache'})
    try:
        with urllib.request.urlopen(request, timeout=22) as response:
            data=response.read(); status=response.status
    except urllib.error.HTTPError as error:
        status=error.code; data=error.read()
    if status not in allowed: raise RuntimeError(f'Verification HTTP{status}: {path}')
    return status, data

def read_json(path, payload=None): return json.loads(fetch(path,payload)[1])
def digest(data): return hashlib.sha256(data).hexdigest()

def probe(sites, jobs=24, reps=2, count=3):
    types=['battery','tyre','breakdown','collision']
    units=[{'id':f'probe-{i+1}', 'kind':['motorcycle','service_van','flatbed'][i%3], 'siteId':sites[i%len(sites)]['id'],
        'capabilities':types, 'available':True,'shiftStartMinutes':0,'shiftEndMinutes':480} for i in range(count)]
    return {'schemaVersion':'1','seed':42,'horizonMinutes':480,'replications':reps,'jobCount':jobs,
        'responseTargetMinutes':30,'arrivalWeights':[1]*8,'dispatchPrepMinutes':3,'recoveryMinutes':15,'travelMultiplier':1,
        'typeProfiles':{name:{'share':.25,'onSiteMinutes':{'min':10,'mode':20,'max':40},
            'flatbedTransportMinutes':20 if name in ('breakdown','collision') else 0,
            'flatbedDropoffMinutes':10 if name in ('breakdown','collision') else 0} for name in types},
        'baseline':{'units':units},'candidate':{'units':units}}

def check_capacity(value, request, manifest):
    assert value['input']['jobCount']==request['jobCount'] and value['datasetHash']==manifest['dataset']['hash']
    assert value['matrix']['hash']==manifest['matrix']['hash'] and 'durationsSeconds' not in value['matrix']
    for name in ('baseline','candidate'):
        replay=value[name]['replay']; metrics=replay['metrics']
        assert len(replay['jobs'])==request['jobCount']
        assert metrics['completed']+metrics['inProgress']+metrics['unserved']==request['jobCount']
    assert value['baseline']==value['candidate']
    assert all(row is None or row['mean']==row['min']==row['max']==0 for row in value['delta'].values())

def main(args):
    assert len(args.sha)==40 and all(c in '0123456789abcdef' for c in args.sha)
    run=json.loads(subprocess.check_output(['gh','run','view',str(args.ci_run),'--repo','upgradedev/standby','--json','headSha,status,conclusion']))
    assert run=={'headSha':args.sha,'status':'completed','conclusion':'success'}, 'An exact green source run is required.'
    work=pathlib.Path('.runtime')/('read-release-'+args.sha[:8]); work.mkdir(parents=True,exist_ok=True)
    code=pathlib.Path(args.artifact).joinpath('read.zip').read_bytes()
    with zipfile.ZipFile(pathlib.Path(args.artifact)/'read.zip') as archive:
        assert archive.namelist()==['index.js'] and archive.testzip() is None
    session=boto3.Session(profile_name='default',region_name='eu-west-1')
    identity=session.client('sts').get_caller_identity()
    assert identity['Account']==ACCOUNT and identity['Arn'].endswith(':user/tf-surface-studio')
    stack=session.client('cloudformation').describe_stacks(StackName='standby-mvp')['Stacks'][0]
    assert stack['StackStatus'] in ('CREATE_COMPLETE','UPDATE_COMPLETE')
    outputs={row['OutputKey']:row['OutputValue'] for row in stack['Outputs']}
    assert outputs['Url']==URL
    client=session.client('lambda'); s3=session.client('s3'); cf=session.client('cloudfront')
    before=client.get_function(FunctionName=FUNCTION); config=before['Configuration']; env=config['Environment']['Variables']
    assert config['FunctionArn']==f'arn:aws:lambda:eu-west-1:{ACCOUNT}:function:{FUNCTION}'
    assert config['Runtime']=='nodejs22.x' and config['Timeout']==15 and config['MemorySize']==512
    assert env['RELEASE_SHA']==args.expected_release and config['State']=='Active'
    old_web=s3.get_object(Bucket=outputs['WebBucket'],Key='config.json'); old_bytes=old_web['Body'].read(); web=json.loads(old_bytes)
    assert web['release']==args.expected_release and web['apiBase']=='/api/v1'
    old_html=fetch('/')[1]; old_eval=read_json('/api/v1/public/evaluations',{'fleetSize':3,'thresholdMinutes':10,'cohort':'holdout'})
    assert fetch('/api/v1/workspaces',allowed=(401,))[0]==401
    urllib.request.urlretrieve(before['Code']['Location'],work/'before-read.zip')
    (work/'before-environment.json').write_text(json.dumps(env),encoding='utf-8')
    (work/'before-config.json').write_bytes(old_bytes)
    expected_code=base64.b64encode(hashlib.sha256(code).digest()).decode()
    receipt={'source':args.sha,'ciRun':args.ci_run,'account':ACCOUNT,'function':FUNCTION,'beforeRelease':args.expected_release,
        'beforeCodeSha256':config['CodeSha256'],'newCodeSha256':expected_code,'webAssetsChanged':False,
        'protectedFunctionsChanged':False,'status':'prepared','checks':[]}
    if not args.apply:
        (work/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(receipt)); return
    changed=False; new_etag=None
    new_web_bytes=json.dumps({**web,'release':args.sha}).encode()
    def wait(): client.get_waiter('function_updated_v2').wait(FunctionName=FUNCTION,WaiterConfig={'Delay':1,'MaxAttempts':45})
    def invalidate():
        return cf.create_invalidation(DistributionId=outputs['Distribution'],InvalidationBatch={
            'Paths':{'Quantity':1,'Items':['/config.json']},'CallerReference':'read-'+str(time.time_ns())})['Invalidation']['Id']
    try:
        changed=True  # A timed-out update can still have committed remotely.
        client.update_function_code(FunctionName=FUNCTION,ZipFile=code,RevisionId=config['RevisionId']); wait()
        active=client.get_function_configuration(FunctionName=FUNCTION); assert active['CodeSha256']==expected_code
        client.update_function_configuration(FunctionName=FUNCTION,RevisionId=active['RevisionId'],Environment={'Variables':{**env,'RELEASE_SHA':args.sha}}); wait()
        response=s3.put_object(Bucket=outputs['WebBucket'],Key='config.json',Body=new_web_bytes,
            ContentType='application/json',CacheControl='no-cache,max-age=0',IfMatch=old_web['ETag'])
        new_etag=response['ETag']; receipt['invalidation']=invalidate()
        for attempt in range(15):
            if read_json('/config.json')['release']==args.sha and read_json('/api/v1/health')['release']==args.sha: break
            time.sleep(1)
        else: raise RuntimeError('API/config release verification timed out.')
        manifest=read_json('/api/v1/public/manifest')
        assert manifest['release']==args.sha and manifest['capabilities']['capacity']['modelVersion']=='fixed-home-capacity-v1'
        after=read_json('/api/v1/public/evaluations',{'fleetSize':3,'thresholdMinutes':10,'cohort':'holdout'})
        assert old_eval['plans']==after['plans'] and digest(old_html)==digest(fetch('/')[1])
        assert fetch('/api/v1/workspaces',allowed=(401,))[0]==401
        for label,request in [('default-probe',probe(manifest['dataset']['sites'])),('max-bounds',probe(manifest['dataset']['sites'],200,20,12))]:
            began=time.perf_counter(); value=read_json('/api/v1/public/capacity-evaluations',request)
            elapsed=time.perf_counter()-began; check_capacity(value,request,manifest)
            receipt['checks'].append({'case':label,'jobs':request['jobCount'],'replications':request['replications'],
                'unitsPerPolicy':len(request['baseline']['units']),'elapsedSeconds':elapsed,'inputHash':value['inputHash'],
                'datasetHash':value['datasetHash'],'matrixHash':value['matrix']['hash'],'conservation':'pass','pairedIdentical':'pass'})
        receipt['status']='verified'; receipt['verifiedAtUtc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    except Exception as error:
        receipt['status']='failed'; receipt['failure']=type(error).__name__
        if changed:
            wait()
            current=client.get_function_configuration(FunctionName=FUNCTION)
            client.update_function_code(FunctionName=FUNCTION,ZipFile=(work/'before-read.zip').read_bytes(),RevisionId=current['RevisionId']); wait()
            current=client.get_function_configuration(FunctionName=FUNCTION)
            client.update_function_configuration(FunctionName=FUNCTION,Environment={'Variables':env},RevisionId=current['RevisionId']); wait()
            if not new_etag:
                observed=s3.get_object(Bucket=outputs['WebBucket'],Key='config.json')
                if observed['Body'].read()==new_web_bytes: new_etag=observed['ETag']
            if new_etag:
                s3.put_object(Bucket=outputs['WebBucket'],Key='config.json',Body=old_bytes,ContentType='application/json',
                    CacheControl=old_web.get('CacheControl','no-cache,max-age=0'),IfMatch=new_etag); invalidate()
            receipt['rollback']='restored previous read code/environment and config'
        raise
    finally:
        (work/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact',required=True); parser.add_argument('--sha',required=True); parser.add_argument('--ci-run',required=True,type=int)
    parser.add_argument('--expected-release',required=True); parser.add_argument('--apply',action='store_true')
    main(parser.parse_args())
