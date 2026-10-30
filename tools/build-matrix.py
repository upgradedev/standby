"""Owner-only bounded Amazon Location builder; never exposed through the API.

Every attempt atomically reserves pairs before any billed call. SDK retries are
disabled; ambiguous failures remain charged against quota. No provider payload
is written to logs, source control or CI artifacts.
"""
import argparse,datetime,hashlib,json,math,pathlib,sys
import boto3
from botocore.config import Config

def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def fingerprint(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def run(args):
    session=boto3.Session(profile_name='default',region_name='eu-west-1')
    identity=session.client('sts').get_caller_identity()
    if identity['Account']!='308857099262': raise RuntimeError('Wrong AWS account')
    outputs={x['OutputKey']:x['OutputValue'] for x in session.client('cloudformation').describe_stacks(StackName='standby-mvp')['Stacks'][0]['Outputs']}
    source=pathlib.Path(args.input)
    spec=json.loads(source.read_text())
    if spec['profile']!='Car' or spec['bounds']!=[-97.88,30.18,-97.62,30.46]: raise RuntimeError('Only the frozen study profile and region are allowed')
    origins,destinations=spec['origins'],spec['destinations']
    if not 1<=len(origins)<=12 or not 1<=len(destinations)<=240: raise RuntimeError('Finite model bounds exceeded')
    if len({x['id'] for x in origins})!=len(origins) or len({x['id'] for x in destinations})!=len(destinations): raise RuntimeError('Duplicate matrix IDs')
    for p in origins+destinations:
        lon,lat=p['position']
        if not all(math.isfinite(x) for x in [lon,lat]) or not(-97.88<=lon<=-97.62 and 30.18<=lat<=30.46): raise RuntimeError('Position outside frozen region')
    credentials=session.client('sts').assume_role(RoleArn=outputs['BuilderRoleArn'],RoleSessionName='standby-owner-matrix')['Credentials']
    builder=boto3.Session(aws_access_key_id=credentials['AccessKeyId'],aws_secret_access_key=credentials['SecretAccessKey'],aws_session_token=credentials['SessionToken'],region_name='eu-west-1')
    ddb=builder.client('dynamodb',config=Config(retries={'max_attempts':0}))
    table=outputs['BuilderControlTable'];pairs=len(origins)*len(destinations)
    budget_key={'pk':{'S':'BUDGET'},'sk':{'S':'INITIAL'}}
    try:
        ddb.put_item(TableName=table,Item={**budget_key,'remainingPairs':{'N':'8640'},'initialPairs':{'N':'8640'}},ConditionExpression='attribute_not_exists(pk)')
    except ddb.exceptions.ConditionalCheckFailedException: pass
    job_hash=fingerprint(spec)
    attempt_key={'pk':{'S':'JOB#'+job_hash},'sk':{'S':'ATTEMPT#'+str(args.attempt)}}
    now=datetime.datetime.now(datetime.timezone.utc)
    ddb.transact_write_items(TransactItems=[
        {'Update':{'TableName':table,'Key':budget_key,'UpdateExpression':'SET remainingPairs = remainingPairs - :pairs','ConditionExpression':'remainingPairs >= :pairs','ExpressionAttributeValues':{':pairs':{'N':str(pairs)}}}},
        {'Put':{'TableName':table,'Item':{**attempt_key,'pairs':{'N':str(pairs)},'status':{'S':'RESERVED'},'reservedAt':{'S':now.isoformat()}},'ConditionExpression':'attribute_not_exists(pk)'}}])
    # Expand routing geometry before the first call to permit normal road detours.
    # This never changes cohort eligibility or zone assignment.
    west,south,east,north=spec['bounds']
    request={'Origins':[{'Position':p['position']} for p in origins],
        'Destinations':[{'Position':p['position']} for p in destinations],
        'TravelMode':'Car','OptimizeRoutingFor':'FastestRoute','Traffic':{'Usage':'IgnoreTrafficData'},
        'RoutingBoundary':{'Geometry':{'BoundingBox':[west-0.1,south-0.1,east+0.1,north+0.1]}}}
    response=builder.client('geo-routes',config=Config(retries={'max_attempts':0},read_timeout=90)).calculate_route_matrix(**request)
    if response.get('PricingBucket')!='Core': raise RuntimeError('Unexpected routing pricing bucket; do not retry automatically')
    rows=response.get('RouteMatrix',[])
    if len(rows)!=len(origins) or any(len(row)!=len(destinations) for row in rows): raise RuntimeError('Incomplete route matrix')
    durations=[];unreachable=0
    for row in rows:
        times=[]
        for cell in row:
            error=cell.get('Error')
            if error=='NoRoute': times.append(None);unreachable+=1
            elif error: raise RuntimeError('Matrix has a non-NoRoute provider error; no zero/fallback substitution is allowed: '+error)
            else:
                seconds=cell.get('Duration')
                if not isinstance(seconds,(int,float)) or not math.isfinite(seconds) or seconds<0: raise RuntimeError('Malformed duration')
                times.append(seconds)
        durations.append(times)
    expires=now+datetime.timedelta(days=28)
    matrix={'schemaVersion':'1','id':'here-car-'+now.strftime('%Y%m%dT%H%M%SZ'),'datasetHash':spec['datasetHash'],
        'provider':'HERE','profile':'Car','generatedAt':now.isoformat(),'expiresAt':expires.isoformat(),
        'siteIds':[x['id'] for x in origins],'zoneIds':[x['id'] for x in destinations],'durationsSeconds':durations}
    matrix['hash']=fingerprint(matrix)
    encoded=canonical(matrix).encode()
    s3=builder.client('s3',config=Config(retries={'max_attempts':0}))
    s3.put_object(Bucket=outputs['CacheBucket'],Key='matrix/active.json',Body=encoded,ContentType='application/json',CacheControl='no-store',Metadata={'expires-at':expires.isoformat()})
    saved=s3.get_object(Bucket=outputs['CacheBucket'],Key='matrix/active.json')['Body'].read()
    if saved!=encoded: raise RuntimeError('Stored matrix bytes did not match the verified result')
    ddb.update_item(TableName=table,Key=attempt_key,UpdateExpression='SET #status=:status,matrixHash=:hash,completedAt=:at',ExpressionAttributeNames={'#status':'status'},
        ExpressionAttributeValues={':status':{'S':'SUCCEEDED'},':hash':{'S':matrix['hash']},':at':{'S':datetime.datetime.now(datetime.timezone.utc).isoformat()}})
    receipt={key:matrix[key] for key in ['id','hash','datasetHash','generatedAt','expiresAt','provider','profile']}
    receipt.update({'pairsReserved':pairs,'knownNoRouteCells':unreachable,'pricingBucket':response['PricingBucket'],'estimatedRoutingUsd':pairs*0.0005,'requestHash':fingerprint(request),'attempt':args.attempt})
    out=pathlib.Path('.runtime/matrix-receipt.json');out.parent.mkdir(exist_ok=True);out.write_text(canonical(receipt)+'\n')
    print(canonical(receipt))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--attempt',required=True,type=int,choices=[1,2,3])
    run(parser.parse_args())
