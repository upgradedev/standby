"""Generate reproducible CloudFormation without local build dependencies.

Lambda code is supplied separately from the reviewed hosted-CI artifact.
No provider-derived data is embedded in infrastructure or source control.
"""
import json
from pathlib import Path

def ref(name): return {'Ref':name}
def get(name,attr): return {'Fn::GetAtt':[name,attr]}
def sub(value): return {'Fn::Sub':value}
def statement(actions,resources):
    return {'Effect':'Allow','Action':actions,'Resource':resources}
resources={}
def resource(name,kind,properties,**extra):
    resources[name]={'Type':kind,'Properties':properties,**extra}
tags=[{'Key':'Project','Value':'standby'}]
for name in ['WebBucket','SourceBucket','CacheBucket']:
    props={'PublicAccessBlockConfiguration':{'BlockPublicAcls':True,'IgnorePublicAcls':True,'BlockPublicPolicy':True,'RestrictPublicBuckets':True},
        'OwnershipControls':{'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]},
        'BucketEncryption':{'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},'Tags':tags}
    if name=='CacheBucket': props['LifecycleConfiguration']={'Rules':[{'Id':'ProviderRetentionBackstop','Status':'Enabled','ExpirationInDays':29,'AbortIncompleteMultipartUpload':{'DaysAfterInitiation':1}}]}
    resource(name,'AWS::S3::Bucket',props,DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
for name in ['PlansTable','BuilderControlTable']:
    resource(name,'AWS::DynamoDB::Table',{'BillingMode':'PAY_PER_REQUEST','AttributeDefinitions':[{'AttributeName':'pk','AttributeType':'S'},{'AttributeName':'sk','AttributeType':'S'}],
        'KeySchema':[{'AttributeName':'pk','KeyType':'HASH'},{'AttributeName':'sk','KeyType':'RANGE'}],
        'SSESpecification':{'SSEEnabled':True},'TimeToLiveSpecification':{'AttributeName':'ttl','Enabled':True},
        'PointInTimeRecoverySpecification':{'PointInTimeRecoveryEnabled':name=='PlansTable'},'Tags':tags},DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
resource('HttpApi','AWS::ApiGatewayV2::Api',{'Name':'standby-api','ProtocolType':'HTTP','Tags':{'Project':'standby'}})
resource('ApiLog','AWS::Logs::LogGroup',{'LogGroupName':'/standby/http-api','RetentionInDays':14,'Tags':tags})
resource('ApiStage','AWS::ApiGatewayV2::Stage',{'ApiId':ref('HttpApi'),'StageName':'$default','AutoDeploy':True,
    'DefaultRouteSettings':{'ThrottlingBurstLimit':10,'ThrottlingRateLimit':3},
    'AccessLogSettings':{'DestinationArn':get('ApiLog','Arn'),'Format':'{"requestId":"$context.requestId","status":"$context.status","routeKey":"$context.routeKey","responseLength":"$context.responseLength"}'},'Tags':{'Project':'standby'}})
resource('Oac','AWS::CloudFront::OriginAccessControl',{'OriginAccessControlConfig':{'Name':'standby-web-oac','OriginAccessControlOriginType':'s3','SigningBehavior':'always','SigningProtocol':'sigv4'}})
resource('SpaRewrite','AWS::CloudFront::Function',{'Name':'standby-ui-routes','AutoPublish':True,'FunctionConfig':{'Comment':'Rewrite only known client routes; preserve API and asset errors','Runtime':'cloudfront-js-2.0'},
    'FunctionCode':"function handler(event){var r=event.request; if(['/','/overview','/incidents','/queues','/map','/settings','/auth/callback'].indexOf(r.uri)>=0){r.uri='/index.html';} return r;}"})
resource('ApiRewrite','AWS::CloudFront::Function',{'Name':'standby-api-prefix','AutoPublish':True,'FunctionConfig':{'Comment':'Strip public reverse proxy prefix','Runtime':'cloudfront-js-2.0'},
    'FunctionCode':"function handler(event){var r=event.request;r.uri=r.uri.replace(/^\\/api\\//,'/');return r;}"})
resource('SecurityHeaders','AWS::CloudFront::ResponseHeadersPolicy',{'ResponseHeadersPolicyConfig':{'Name':'standby-security','SecurityHeadersConfig':{
    'ContentTypeOptions':{'Override':True},'FrameOptions':{'FrameOption':'DENY','Override':True},
    'ReferrerPolicy':{'ReferrerPolicy':'strict-origin-when-cross-origin','Override':True},
    'StrictTransportSecurity':{'AccessControlMaxAgeSec':31536000,'IncludeSubdomains':True,'Override':True},
    'ContentSecurityPolicy':{'Override':True,'ContentSecurityPolicy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.amazonaws.com; font-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://*.amazoncognito.com"}}}})
default_behavior={'TargetOriginId':'web','ViewerProtocolPolicy':'redirect-to-https','Compress':True,
    'AllowedMethods':['GET','HEAD','OPTIONS'],'CachedMethods':['GET','HEAD'],
    'CachePolicyId':'658327ea-f89d-4fab-a63d-7e88639e58f6','ResponseHeadersPolicyId':ref('SecurityHeaders'),
    'FunctionAssociations':[{'EventType':'viewer-request','FunctionARN':get('SpaRewrite','FunctionARN')}]}
api_behavior={'PathPattern':'/api/*','TargetOriginId':'api','ViewerProtocolPolicy':'https-only','Compress':True,
    'AllowedMethods':['GET','HEAD','OPTIONS','PUT','POST','PATCH','DELETE'],'CachedMethods':['GET','HEAD'],
    'CachePolicyId':'4135ea2d-6df8-44a3-9df3-4b5a84be39ad','OriginRequestPolicyId':'b689b0a8-53d0-40ab-baf2-68738e2966ac',
    'ResponseHeadersPolicyId':ref('SecurityHeaders'),'FunctionAssociations':[{'EventType':'viewer-request','FunctionARN':get('ApiRewrite','FunctionARN')}]}
resource('Distribution','AWS::CloudFront::Distribution',{'DistributionConfig':{'Enabled':True,'Comment':'Standby anonymous operations console','DefaultRootObject':'index.html','HttpVersion':'http2and3','IPV6Enabled':True,'PriceClass':'PriceClass_100',
    'Origins':[{'Id':'web','DomainName':get('WebBucket','RegionalDomainName'),'OriginAccessControlId':ref('Oac'),'S3OriginConfig':{'OriginAccessIdentity':''}},
        {'Id':'api','DomainName':sub('${HttpApi}.execute-api.${AWS::Region}.amazonaws.com'),'CustomOriginConfig':{'OriginProtocolPolicy':'https-only','OriginSSLProtocols':['TLSv1.2']}}],
    'DefaultCacheBehavior':default_behavior,'CacheBehaviors':[api_behavior],
    'ViewerCertificate':{'CloudFrontDefaultCertificate':True},'Restrictions':{'GeoRestriction':{'RestrictionType':'none'}}},'Tags':tags})
resource('WebBucketPolicy','AWS::S3::BucketPolicy',{'Bucket':ref('WebBucket'),'PolicyDocument':{'Version':'2012-10-17','Statement':[
    {'Effect':'Allow','Principal':{'Service':'cloudfront.amazonaws.com'},'Action':'s3:GetObject','Resource':sub('${WebBucket.Arn}/*'),'Condition':{'StringEquals':{'AWS:SourceArn':sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}')}}},
    {'Effect':'Deny','Principal':'*','Action':'s3:*','Resource':[get('WebBucket','Arn'),sub('${WebBucket.Arn}/*')],'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]}})
for bucket in ['SourceBucket','CacheBucket']:
    resource(bucket+'Policy','AWS::S3::BucketPolicy',{'Bucket':ref(bucket),'PolicyDocument':{'Version':'2012-10-17','Statement':[
        {'Effect':'Deny','Principal':'*','Action':'s3:*','Resource':[get(bucket,'Arn'),sub('${'+bucket+'.Arn}/*')],'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]}})
resource('UserPool','AWS::Cognito::UserPool',{'UserPoolName':'standby-operators','AdminCreateUserConfig':{'AllowAdminCreateUserOnly':True},
    'Policies':{'PasswordPolicy':{'MinimumLength':14,'RequireLowercase':True,'RequireUppercase':True,'RequireNumbers':True,'RequireSymbols':True,'TemporaryPasswordValidityDays':7}},
    'UserPoolTags':{'Project':'standby'}})
resource('AuthDomain','AWS::Cognito::UserPoolDomain',{'Domain':sub('standby-${AWS::AccountId}'),'UserPoolId':ref('UserPool')})
resource('ResourceServer','AWS::Cognito::UserPoolResourceServer',{'UserPoolId':ref('UserPool'),'Identifier':'standby','Name':'Standby workspace access','Scopes':[{'ScopeName':'access','ScopeDescription':'Access authorized Standby workspaces'}]})
resource('UserClient','AWS::Cognito::UserPoolClient',{'UserPoolId':ref('UserPool'),'ClientName':'standby-console','GenerateSecret':False,
    'AllowedOAuthFlowsUserPoolClient':True,'AllowedOAuthFlows':['code'],'AllowedOAuthScopes':['openid','profile','standby/access'],
    'SupportedIdentityProviders':['COGNITO'],'CallbackURLs':[sub('https://${Distribution.DomainName}/auth/callback')],
    'LogoutURLs':[sub('https://${Distribution.DomainName}/overview')],'PreventUserExistenceErrors':'ENABLED',
    'AccessTokenValidity':30,'IdTokenValidity':30,'RefreshTokenValidity':1,
    'TokenValidityUnits':{'AccessToken':'minutes','IdToken':'minutes','RefreshToken':'days'}},DependsOn='ResourceServer')
for group in ['Analyst','Planner','Admin']:
    resource(group+'Group','AWS::Cognito::UserPoolGroup',{'UserPoolId':ref('UserPool'),'GroupName':group})
resource('JwtAuthorizer','AWS::ApiGatewayV2::Authorizer',{'ApiId':ref('HttpApi'),'AuthorizerType':'JWT','IdentitySource':['$request.header.Authorization'],'Name':'standby-access',
    'JwtConfiguration':{'Audience':[ref('UserClient')],'Issuer':sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPool}')}})
log_statement=statement(['logs:CreateLogStream','logs:PutLogEvents'],sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/standby-*:*'))
read_statements=[log_statement,statement(['s3:GetObject'],[sub('${SourceBucket.Arn}/curated/*'),sub('${CacheBucket.Arn}/matrix/*')])]
writer_statements=read_statements+[statement(['s3:PutObject','s3:GetObject'],sub('${CacheBucket.Arn}/results/*')),
    statement(['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:Query','dynamodb:ConditionCheckItem','dynamodb:TransactWriteItems'],get('PlansTable','Arn'))]
retention_statements=[log_statement,statement(['s3:ListBucket'],get('CacheBucket','Arn')),statement(['s3:GetObject','s3:DeleteObject'],sub('${CacheBucket.Arn}/*'))]
for name,statements in [('Read',read_statements),('Writer',writer_statements),('Retention',retention_statements)]:
    resource(name+'Role','AWS::IAM::Role',{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},
        'Policies':[{'PolicyName':'standby-'+name.lower(),'PolicyDocument':{'Version':'2012-10-17','Statement':statements}}],'Tags':tags})
    resource(name+'Log','AWS::Logs::LogGroup',{'LogGroupName':'/aws/lambda/standby-'+name.lower(),'RetentionInDays':14,'Tags':tags})
    resource(name+'Function','AWS::Lambda::Function',{'FunctionName':'standby-'+name.lower(),'Runtime':'nodejs22.x','Architectures':['arm64'],
        'Handler':'index.handler','Role':get(name+'Role','Arn'),'MemorySize':256 if name=='Retention' else 512,
        'Timeout':60 if name=='Retention' else 15,'ReservedConcurrentExecutions':1 if name=='Retention' else (8 if name=='Read' else 3),
        'Environment':{'Variables':{'SOURCE_BUCKET':ref('SourceBucket'),'CACHE_BUCKET':ref('CacheBucket'),'TABLE_NAME':ref('PlansTable'),
            'USER_POOL_ID':ref('UserPool'),'RELEASE_SHA':ref('ReleaseSha'),'DATASET_KEY':'curated/dataset.json','MATRIX_KEY':'matrix/active.json'}},
        'Code':{'ZipFile':"exports.handler=async()=>({statusCode:503,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({code:'RELEASE_PENDING',message:'The release is being prepared.'})});"},'Tags':tags},DependsOn=name+'Log')
    resource(name+'Errors','AWS::CloudWatch::Alarm',{'AlarmName':'standby-'+name.lower()+'-errors','Namespace':'AWS/Lambda','MetricName':'Errors','Dimensions':[{'Name':'FunctionName','Value':ref(name+'Function')}],
        'Statistic':'Sum','Period':300,'EvaluationPeriods':1,'Threshold':1,'ComparisonOperator':'GreaterThanOrEqualToThreshold','TreatMissingData':'notBreaching'})
for name in ['Read','Writer']:
    resource(name+'Integration','AWS::ApiGatewayV2::Integration',{'ApiId':ref('HttpApi'),'IntegrationType':'AWS_PROXY','IntegrationUri':get(name+'Function','Arn'),'PayloadFormatVersion':'2.0','TimeoutInMillis':15000})
    resource(name+'Invoke','AWS::Lambda::Permission',{'FunctionName':ref(name+'Function'),'Action':'lambda:InvokeFunction','Principal':'apigateway.amazonaws.com','SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${HttpApi}/*')})
for key,route,kind in [('Public','ANY /v1/public/{proxy+}','Read'),('Health','GET /v1/health','Read'),('Workspaces','GET /v1/workspaces','Writer'),('Protected','ANY /v1/workspaces/{proxy+}','Writer')]:
    props={'ApiId':ref('HttpApi'),'RouteKey':route,'Target':sub('integrations/${'+kind+'Integration}')}
    if kind=='Writer': props.update({'AuthorizationType':'JWT','AuthorizerId':ref('JwtAuthorizer'),'AuthorizationScopes':['standby/access']})
    resource(key+'Route','AWS::ApiGatewayV2::Route',props)
resource('RetentionSchedule','AWS::Events::Rule',{'Description':'Delete expired provider cache before the 30-day provider limit','ScheduleExpression':'rate(1 day)','State':'ENABLED',
    'Targets':[{'Id':'retention','Arn':get('RetentionFunction','Arn')}]})
resource('RetentionInvoke','AWS::Lambda::Permission',{'FunctionName':ref('RetentionFunction'),'Action':'lambda:InvokeFunction','Principal':'events.amazonaws.com','SourceArn':get('RetentionSchedule','Arn')})
resource('BuilderRole','AWS::IAM::Role',{'RoleName':'standby-data-builder','MaxSessionDuration':3600,
    'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'AWS':sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:user/tf-surface-studio')},'Action':'sts:AssumeRole'}]},
    'Policies':[{'PolicyName':'bounded-owner-builder','PolicyDocument':{'Version':'2012-10-17','Statement':[
        statement(['geo-routes:CalculateRouteMatrix'],sub('arn:${AWS::Partition}:geo-routes:${AWS::Region}::provider/default')),
        statement(['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:TransactWriteItems'],get('BuilderControlTable','Arn')),
        statement(['s3:GetObject','s3:PutObject'],[sub('${SourceBucket.Arn}/*'),sub('${CacheBucket.Arn}/matrix/*')])
    ]}}],'Tags':tags})
resource('MapKey','AWS::Location::APIKey',{'KeyName':'standby-map-viewer','Description':'Map rendering only; no routes or management rights',
    'ExpireTime':'2026-11-14T21:00:00Z','Restrictions':{'AllowActions':['geo-maps:GetTile'],
        'AllowResources':[sub('arn:${AWS::Partition}:geo-maps:${AWS::Region}::provider/default')],
        'AllowReferers':[sub('https://${Distribution.DomainName}/*')]}})
resource('Budget','AWS::Budgets::Budget',{'Budget':{'BudgetName':'standby-approved-usd25','BudgetType':'COST','TimeUnit':'ANNUALLY',
    'BudgetLimit':{'Amount':25,'Unit':'USD'},'CostFilters':{'TagKeyValue':['user:Project$standby']}}})
resource('ApiFailures','AWS::CloudWatch::Alarm',{'AlarmName':'standby-http-api-5xx','Namespace':'AWS/ApiGateway','MetricName':'5xx',
    'Dimensions':[{'Name':'ApiId','Value':ref('HttpApi')},{'Name':'Stage','Value':'$default'}],
    'Statistic':'Sum','Period':300,'EvaluationPeriods':1,'Threshold':1,'ComparisonOperator':'GreaterThanOrEqualToThreshold','TreatMissingData':'notBreaching'})
outputs={name:{'Value':ref(name)} for name in ['WebBucket','SourceBucket','CacheBucket','PlansTable','BuilderControlTable','Distribution','UserPool','UserClient','MapKey']}
outputs.update({'Url':{'Value':sub('https://${Distribution.DomainName}')},'BuilderRoleArn':{'Value':get('BuilderRole','Arn')},
    'AuthDomain':{'Value':sub('https://standby-${AWS::AccountId}.auth.${AWS::Region}.amazoncognito.com')},'ApiUrl':{'Value':get('HttpApi','ApiEndpoint')}})
template={'AWSTemplateFormatVersion':'2010-09-09','Description':'Standby isolated serverless roadside coverage console',
    'Parameters':{'ReleaseSha':{'Type':'String','Default':'development'}},'Resources':resources,'Outputs':outputs}
if __name__=='__main__':
    path=Path('.runtime/template.json');path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(template,indent=2)+'\n')
    print(path)
