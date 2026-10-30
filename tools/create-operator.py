"""Owner-operated enrollment. No invitation, password file or browser role selector.

Run interactively in the owner's terminal. The owner enters a new password;
agents must not collect that password in a chat or a command argument.
"""
import argparse,getpass,json,pathlib,re
import boto3

def main(args):
    if not re.fullmatch(r'[A-Za-z0-9_.-]{3,60}',args.username): raise ValueError('Use a 3–60 character username containing letters, digits, dots, underscores or hyphens.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',args.workspace): raise ValueError('Invalid workspace identifier.')
    session=boto3.Session(profile_name='default',region_name='eu-west-1')
    if session.client('sts').get_caller_identity()['Account']!='308857099262': raise RuntimeError('Wrong AWS account')
    outputs={v['OutputKey']:v['OutputValue'] for v in session.client('cloudformation').describe_stacks(StackName='standby-mvp')['Stacks'][0]['Outputs']}
    client=session.client('cognito-idp')
    try:
        client.admin_get_user(UserPoolId=outputs['UserPool'],Username=args.username)
    except client.exceptions.UserNotFoundException: pass
    else: raise RuntimeError('That operator already exists. This enrollment command never changes an existing password or role.')
    password=getpass.getpass('Choose your operator password (at least 14 characters, upper/lower/number/symbol): ')
    if password!=getpass.getpass('Confirm password: '): raise ValueError('Passwords do not match.')
    if len(password)<14 or not all(re.search(p,password) for p in [r'[A-Z]',r'[a-z]',r'[0-9]',r'[^A-Za-z0-9]']): raise ValueError('Password does not meet the configured policy.')
    user=client.admin_create_user(UserPoolId=outputs['UserPool'],Username=args.username,TemporaryPassword=password,MessageAction='SUPPRESS')['User']
    client.admin_set_user_password(UserPoolId=outputs['UserPool'],Username=args.username,Password=password,Permanent=True)
    client.admin_add_user_to_group(UserPoolId=outputs['UserPool'],Username=args.username,GroupName=args.role)
    subject=next(a['Value'] for a in user['Attributes'] if a['Name']=='sub')
    session.resource('dynamodb').Table(outputs['PlansTable']).put_item(Item={'pk':'USER#'+subject,'sk':'WORKSPACE#'+args.workspace,
        'workspaceId':args.workspace,'name':args.workspace_name,'role':args.role},ConditionExpression='attribute_not_exists(pk)')
    print('Operator enrolled. Use Operator sign in at '+outputs['Url']+'. No email invitation was sent.')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--username',required=True);parser.add_argument('--role',choices=['Analyst','Planner','Admin'],default='Admin')
    parser.add_argument('--workspace',default='austin');parser.add_argument('--workspace-name',default='Austin Operations')
    main(parser.parse_args())
