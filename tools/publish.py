"""Publish a reviewed hosted-CI release to the dedicated Standby stack.

Supply the exact CI source SHA. This script never creates route matrices and
never grants public access to the raw or provider cache buckets.
"""
import argparse,json,mimetypes,pathlib,time
import boto3

def main(args):
    if len(args.sha)!=40 or any(c not in '0123456789abcdef' for c in args.sha): raise RuntimeError('Supply the full immutable source commit SHA')
    session=boto3.Session(profile_name='default',region_name='eu-west-1')
    if session.client('sts').get_caller_identity()['Account']!='308857099262': raise RuntimeError('Wrong AWS account')
    stack=session.client('cloudformation').describe_stacks(StackName='standby-mvp')['Stacks'][0]
    if stack['StackStatus'] not in ['CREATE_COMPLETE','UPDATE_COMPLETE']: raise RuntimeError('Infrastructure is not ready')
    outputs={x['OutputKey']:x['OutputValue'] for x in stack['Outputs']}
    release=pathlib.Path(args.artifact)
    for name in ['read','writer','retention']:
        zip_bytes=(release/(name+'.zip')).read_bytes()
        session.client('lambda').update_function_code(FunctionName='standby-'+name,ZipFile=zip_bytes)
    s3=session.client('s3')
    for path in sorted((release/'web').rglob('*')):
        if not path.is_file(): continue
        key=path.relative_to(release/'web').as_posix()
        content_type=mimetypes.guess_type(key)[0] or 'application/octet-stream'
        if key.endswith('.js'): content_type='text/javascript'
        s3.put_object(Bucket=outputs['WebBucket'],Key=key,Body=path.read_bytes(),ContentType=content_type,
            CacheControl='public,max-age=31536000,immutable' if key.startswith('assets/') else 'no-cache,max-age=0')
    # Map viewer key is intentionally public, map-only, origin-restricted and expiring.
    key=session.client('location').describe_key(KeyName=outputs['MapKey'])['Key']
    config={'apiBase':'/api/v1','mapStyleUrl':f'https://maps.geo.eu-west-1.amazonaws.com/v2/styles/Monochrome/descriptor?color-scheme=Dark&key={key}',
        'release':args.sha,'auth':{'domain':outputs['AuthDomain'],'clientId':outputs['UserClient'],
        'issuer':f'https://cognito-idp.eu-west-1.amazonaws.com/{outputs["UserPool"]}',
        'redirectUri':outputs['Url']+'/auth/callback'}}
    s3.put_object(Bucket=outputs['WebBucket'],Key='config.json',Body=json.dumps(config).encode(),ContentType='application/json',CacheControl='no-cache,max-age=0')
    for name in ['read','writer','retention']:
        client=session.client('lambda');client.get_waiter('function_updated_v2').wait(FunctionName='standby-'+name,WaiterConfig={'Delay':1,'MaxAttempts':45})
        current=client.get_function_configuration(FunctionName='standby-'+name)
        env=current['Environment']['Variables'];env['RELEASE_SHA']=args.sha
        client.update_function_configuration(FunctionName='standby-'+name,Environment={'Variables':env})
    session.client('cloudfront').create_invalidation(DistributionId=outputs['Distribution'],InvalidationBatch={'Paths':{'Quantity':4,'Items':['/index.html','/config.json','/','/overview']},'CallerReference':args.sha+'-'+str(time.time_ns())})
    pathlib.Path('.runtime/release-receipt.json').write_text(json.dumps({'sha':args.sha,'url':outputs['Url'],'distribution':outputs['Distribution'],'publishedAt':time.time()},indent=2)+'\n')
    print(json.dumps({'sha':args.sha,'url':outputs['Url'],'status':'published; live verification required'}))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--artifact',required=True);parser.add_argument('--sha',required=True)
    main(parser.parse_args())
