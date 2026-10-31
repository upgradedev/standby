"""Bounded disposable QA identities; default is read-only preflight.

Create:  python tools/qa-operators.py create --run-id <12 lowercase hex> [--apply]
Cleanup: python tools/qa-operators.py cleanup --receipt .runtime/qa-operators-<id>/receipt.json [--apply]
Only identities.json contains generated passwords. Never print/upload that file except
through the owner's reviewed secret handoff. This tool never writes GitHub secrets.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import string
import subprocess
import sys
import tempfile
import time
import uuid

ACCOUNT, REGION, STACK = '308857099262', 'eu-west-1', 'standby-mvp'
ARN = f'arn:aws:iam::{ACCOUNT}:user/tf-surface-studio'
ROLES = ('Analyst', 'Planner', 'Admin')
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.runtime'
MARKER = 'QA#OWNERSHIP'


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def local_dir(run):
    require(re.fullmatch(r'[a-f0-9]{12}', run or ''), 'invalid-run-id')
    require(not BASE.is_symlink() and BASE.resolve() == BASE, 'runtime-path-redirect')
    path = BASE / f'qa-operators-{run}'
    require(not path.is_symlink() and path.resolve() == path, 'receipt-directory-path-redirect')
    require(subprocess.run(['git', 'check-ignore', '--quiet', '--', str(path / 'receipt.json')], cwd=ROOT).returncode == 0, 'runtime-not-ignored')
    return path


def save(path, value, exclusive=False):
    require(not path.is_symlink(), 'artifact-symlink')
    if exclusive:
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
        return
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='receipt-', suffix='.tmp')
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
    os.replace(temporary, path)


def users_for(run):
    return [{'role': role, 'username': f'qa-{run}-{role.lower()}', 'sub': None} for role in ROLES]


def validate_receipt(value, path):
    require(value.get('schema') == 'standby-qa-v1', 'receipt-schema')
    run = value.get('runId')
    require(path == local_dir(run) / 'receipt.json', 'receipt-path-mismatch')
    require(value.get('workspaceId') == f'qa-{run}', 'receipt-workspace-mismatch')
    require(str(uuid.UUID(value['ownershipToken'])) == value['ownershipToken'], 'receipt-token-invalid')
    users = value.get('users')
    require(isinstance(users, list) and len(users) == 3, 'receipt-user-count')
    for actual, expected in zip(users, users_for(run)):
        require(all(actual.get(key) == expected[key] for key in ('role', 'username')), 'receipt-user-mismatch')
        if actual.get('sub') is not None:
            require(str(uuid.UUID(actual['sub'])) == actual['sub'], 'receipt-sub-invalid')
    subs = [user['sub'] for user in users if user.get('sub')]
    require(len(subs) == len(set(subs)), 'duplicate-sub')


class Cloud:
    def __init__(self):
        import boto3
        from botocore.config import Config
        self.session = boto3.Session(profile_name='default', region_name=REGION)
        config = Config(connect_timeout=5, read_timeout=15, retries={'total_max_attempts': 1})
        self.clients = {name: self.session.client(name, config=config) for name in ('sts', 'cloudformation', 'cognito-idp', 'dynamodb', 's3')}
        self.cognito, self.ddb, self.s3 = (self.clients[name] for name in ('cognito-idp', 'dynamodb', 's3'))
        self.binding = self.bind()

    def bind(self):
        identity = self.clients['sts'].get_caller_identity()
        require(identity['Account'] == ACCOUNT and identity['Arn'] == ARN, 'wrong-aws-identity')
        cf = self.clients['cloudformation']
        stack = cf.describe_stacks(StackName=STACK)['Stacks'][0]
        require(stack['StackStatus'] in ('CREATE_COMPLETE', 'UPDATE_COMPLETE'), 'stack-not-stable')
        outputs = {row['OutputKey']: row['OutputValue'] for row in stack['Outputs']}
        selected = {key: outputs[key] for key in ('UserPool', 'PlansTable', 'CacheBucket')}
        for logical, physical in selected.items():
            require(cf.describe_stack_resource(StackName=stack['StackId'], LogicalResourceId=logical)['StackResourceDetail']['PhysicalResourceId'] == physical, 'stack-resource-mismatch')
        pool, table, cache = (selected[key] for key in ('UserPool', 'PlansTable', 'CacheBucket'))
        require(self.cognito.describe_user_pool(UserPoolId=pool)['UserPool']['Arn'] == f'arn:aws:cognito-idp:{REGION}:{ACCOUNT}:userpool/{pool}', 'pool-owner-mismatch')
        description = self.ddb.describe_table(TableName=table)['Table']
        require(description['TableArn'] == f'arn:aws:dynamodb:{REGION}:{ACCOUNT}:table/{table}' and description['TableStatus'] == 'ACTIVE', 'table-owner-mismatch')
        self.s3.head_bucket(Bucket=cache, ExpectedBucketOwner=ACCOUNT)
        require(not self.s3.get_bucket_versioning(Bucket=cache, ExpectedBucketOwner=ACCOUNT).get('Status'), 'versioned-cache-not-supported')
        for role in ROLES:
            group = self.cognito.get_group(UserPoolId=pool, GroupName=role)['Group']
            require(group['GroupName'] == role and group['UserPoolId'] == pool, 'existing-role-missing')
        return {'account': ACCOUNT, 'region': REGION, 'identityArn': ARN, 'stackId': stack['StackId'], **selected}

    def user(self, username):
        try:
            return self.cognito.admin_get_user(UserPoolId=self.binding['UserPool'], Username=username)
        except self.cognito.exceptions.UserNotFoundException:
            return None

    def groups(self, username):
        names, token, seen = [], None, set()
        for _ in range(8):
            response = self.cognito.admin_list_groups_for_user(UserPoolId=self.binding['UserPool'], Username=username,
                Limit=10, **({'NextToken': token} if token else {}))
            names.extend(item['GroupName'] for item in response.get('Groups', []))
            require(len(names) <= 3 and len(names) == len(set(names)), 'unexpected-user-groups')
            token = response.get('NextToken')
            if not token:
                return set(names)
            require(isinstance(token, str) and token not in seen, 'invalid-group-cursor')
            seen.add(token)
        raise RuntimeError('group-pagination-limit')

    def rows(self, partition, limit=200):
        items, cursor, seen = [], None, set()
        for _ in range(32):
            response = self.ddb.query(TableName=self.binding['PlansTable'], KeyConditionExpression='pk = :pk',
                ExpressionAttributeValues={':pk': {'S': partition}}, ConsistentRead=True, Limit=100,
                **({'ExclusiveStartKey': cursor} if cursor else {}))
            page = response.get('Items', [])
            require(response.get('Count') == len(page), 'invalid-query-page')
            for item in page:
                require(item.get('pk') == {'S': partition} and isinstance(item.get('sk', {}).get('S'), str), 'query-outside-partition')
                key = item['sk']['S']
                require(key not in seen, 'duplicate-query-item')
                seen.add(key)
                items.append(item)
            require(len(items) <= limit, 'query-limit-exceeded')
            cursor = response.get('LastEvaluatedKey')
            if not cursor:
                return items
            require(cursor.get('pk') == {'S': partition} and cursor.get('sk', {}).get('S') in seen, 'invalid-query-cursor')
        raise RuntimeError('query-pagination-limit')

    def objects(self, workspace):
        prefix, keys, token, seen = f'results/{workspace}/', [], None, set()
        for _ in range(32):
            response = self.s3.list_objects_v2(Bucket=self.binding['CacheBucket'], Prefix=prefix, ExpectedBucketOwner=ACCOUNT,
                MaxKeys=100, **({'ContinuationToken': token} if token else {}))
            require(isinstance(response.get('IsTruncated'), bool), 'invalid-object-page')
            page = response.get('Contents', [])
            require(response.get('KeyCount') == len(page), 'invalid-object-count')
            for item in page:
                key = item['Key']
                require(key.startswith(prefix) and key not in keys, 'object-outside-prefix')
                keys.append(key)
            require(len(keys) <= 100, 'object-limit-exceeded')
            if not response['IsTruncated']:
                require(not response.get('NextContinuationToken'), 'unexpected-object-cursor')
                return keys
            token = response.get('NextContinuationToken')
            require(isinstance(token, str) and token and token not in seen, 'invalid-object-cursor')
            seen.add(token)
        raise RuntimeError('object-pagination-limit')

    def delete_row(self, item):
        fields = [key for key in ('pk', 'sk', 'workspaceId', 'role', 'qaRunId', 'ownershipToken') if key in item]
        self.ddb.delete_item(TableName=self.binding['PlansTable'], Key={key: item[key] for key in ('pk', 'sk')},
            ConditionExpression=' AND '.join(f'#f{i} = :v{i}' for i in range(len(fields))),
            ExpressionAttributeNames={f'#f{i}': key for i, key in enumerate(fields)},
            ExpressionAttributeValues={f':v{i}': item[key] for i, key in enumerate(fields)})


def inventory(cloud, receipt):
    workspace, token = receipt['workspaceId'], receipt['ownershipToken']
    members = []
    for user in receipt['users']:
        live = cloud.user(user['username'])
        if live:
            sub = next((entry['Value'] for entry in live['UserAttributes'] if entry['Name'] == 'sub'), None)
            require(live['Username'] == user['username'] and sub and sub == user.get('sub'), 'unbound-or-replaced-user')
            require(cloud.groups(user['username']) <= {user['role']}, 'user-groups-changed')
        if user.get('sub'):
            rows = cloud.rows('USER#' + user['sub'], limit=1)
            for item in rows:
                require(item['sk'] == {'S': 'WORKSPACE#' + workspace} and item.get('workspaceId') == {'S': workspace}
                    and item.get('role') == {'S': user['role']}, 'unexpected-user-membership')
            members.extend(rows)
    rows, objects = cloud.rows('WORKSPACE#' + workspace), cloud.objects(workspace)
    markers = [item for item in rows if item['sk'] == {'S': MARKER}]
    if rows or objects:
        require(len(markers) == 1 and markers[0].get('qaRunId') == {'S': receipt['runId']}
            and markers[0].get('ownershipToken') == {'S': token}, 'workspace-ownership-marker-mismatch')
    require(all('workspaceId' not in item or item['workspaceId'] == {'S': workspace} for item in rows), 'workspace-item-scope-mismatch')
    require(all(item['sk']['S'] == MARKER or item['sk']['S'] == 'SETTINGS'
        or item['sk']['S'].startswith(('PLAN#', 'AUDIT#', 'IDEMPOTENCY#')) for item in rows), 'unexpected-workspace-item')
    return members, rows, objects


def create(cloud, run, apply):
    directory, users, workspace = local_dir(run), users_for(run), f'qa-{run}'
    require(not directory.exists(), 'existing-local-run')
    require(all(cloud.user(user['username']) is None for user in users), 'target-user-exists')
    require(not cloud.rows('WORKSPACE#' + workspace) and not cloud.objects(workspace), 'target-workspace-exists')
    receipt = {'schema': 'standby-qa-v1', 'runId': run, 'workspaceId': workspace, 'ownershipToken': str(uuid.uuid4()),
        'binding': cloud.binding, 'users': users, 'createdAt': datetime.now(timezone.utc).isoformat(), 'status': 'CREATING'}
    if not apply:
        return {'status': 'PREFLIGHT', 'binding': cloud.binding, 'workspaceId': workspace, 'usernames': [user['username'] for user in users]}
    directory.mkdir(parents=True, mode=0o700)
    path, credentials = directory / 'receipt.json', []
    save(path, receipt, exclusive=True)
    try:
        marker = {'pk': {'S': 'WORKSPACE#' + workspace}, 'sk': {'S': MARKER}, 'qaRunId': {'S': run}, 'ownershipToken': {'S': receipt['ownershipToken']}}
        cloud.ddb.put_item(TableName=cloud.binding['PlansTable'], Item=marker, ConditionExpression='attribute_not_exists(pk)')
        for user in users:
            user['phase'] = 'create_pending'
            save(path, receipt)
            password = 'Aa1!' + ''.join(secrets.choice(string.ascii_letters + string.digits + '!@#%_-+') for _ in range(28))
            created = cloud.cognito.admin_create_user(UserPoolId=cloud.binding['UserPool'], Username=user['username'], TemporaryPassword=password, MessageAction='SUPPRESS')['User']
            user['sub'] = next(entry['Value'] for entry in created['Attributes'] if entry['Name'] == 'sub')
            require(created['Username'] == user['username'], 'created-username-mismatch')
            user['phase'] = 'created'
            save(path, receipt)
            live = cloud.user(user['username'])
            require(live and live['Username'] == user['username'] and any(entry['Name'] == 'sub' and entry['Value'] == user['sub'] for entry in live['UserAttributes']), 'created-user-verification-failed')
            # Address subsequent mutations by the immutable recorded sub, not a reusable username.
            cloud.cognito.admin_set_user_password(UserPoolId=cloud.binding['UserPool'], Username=user['sub'], Password=password, Permanent=True)
            cloud.cognito.admin_add_user_to_group(UserPoolId=cloud.binding['UserPool'], Username=user['sub'], GroupName=user['role'])
            cloud.ddb.put_item(TableName=cloud.binding['PlansTable'], Item={'pk': {'S': 'USER#' + user['sub']}, 'sk': {'S': 'WORKSPACE#' + workspace},
                'workspaceId': {'S': workspace}, 'name': {'S': f'Synthetic QA {run}'}, 'role': {'S': user['role']}}, ConditionExpression='attribute_not_exists(pk)')
            user['phase'] = 'ready'
            save(path, receipt)
            credentials.append({key: user[key] for key in ('username', 'role')} | {'password': password, 'workspaceId': workspace})
        require(len(inventory(cloud, receipt)[0]) == 3, 'membership-verification-failed')
        for user in users:
            live = cloud.user(user['username'])
            require(live['UserStatus'] == 'CONFIRMED' and live['Enabled'] is True and cloud.groups(user['username']) == {user['role']}, 'ready-user-verification-failed')
        save(directory / 'identities.json', credentials, exclusive=True)
        receipt['status'] = 'READY'
        save(path, receipt)
    except BaseException:
        receipt['status'] = 'CREATE_INCOMPLETE'
        save(path, receipt)
        raise
    return {'status': 'READY', 'receipt': str(path), 'credentials': 'Private identities.json written; never print its contents.'}


def cleanup(cloud, path, apply):
    require(path.stat().st_size <= 32768 and not path.is_symlink(), 'invalid-receipt-file')
    receipt = json.loads(path.read_text(encoding='utf-8'))
    validate_receipt(receipt, path)
    require(receipt['binding'] == cloud.binding, 'receipt-resource-binding-mismatch')
    members, rows, objects = inventory(cloud, receipt)
    if not apply:
        return {'status': 'CLEANUP_PREFLIGHT', 'workspaceId': receipt['workspaceId'], 'memberships': len(members), 'workspaceItems': len(rows), 'resultObjects': len(objects)}
    receipt['status'] = 'CLEANING'
    save(path, receipt)
    try:
        for item in members:
            cloud.delete_row(item)
        for user in receipt['users']:
            live = cloud.user(user['username'])
            if live:
                require(live['Username'] == user['username'] and any(entry['Name'] == 'sub' and entry['Value'] == user.get('sub') for entry in live['UserAttributes']), 'user-changed-before-delete')
                cloud.cognito.admin_delete_user(UserPoolId=cloud.binding['UserPool'], Username=user['sub'])
        # Existing Writer timeout is 15s. Membership removal blocks new transactions;
        # allow already-started requests to finish before collecting scoped results.
        if members or rows or objects:
            time.sleep(16)
        members, rows, objects = inventory(cloud, receipt)
        require(not members and all(cloud.user(user['username']) is None for user in receipt['users']), 'identity-deletion-not-verified')
        for item in rows:
            if item['sk'] != {'S': MARKER}:
                cloud.delete_row(item)
        for key in objects:
            cloud.s3.delete_object(Bucket=cloud.binding['CacheBucket'], Key=key, ExpectedBucketOwner=ACCOUNT)
        remaining = inventory(cloud, receipt)
        require(not remaining[0] and not remaining[2] and all(item['sk'] == {'S': MARKER} for item in remaining[1]), 'scoped-data-deletion-not-verified')
        for item in remaining[1]:
            cloud.delete_row(item)
        require(not any(inventory(cloud, receipt)) and cloud.bind() == receipt['binding'], 'cleanup-final-verification-failed')
        identities = path.parent / 'identities.json'
        require(not identities.is_symlink(), 'identities-symlink')
        identities.unlink(missing_ok=True)
        require(not identities.exists(), 'local-credentials-remain')
        receipt['status'] = 'CLEANED'
        save(path, receipt)
        archive = {'status': 'PASS', 'completedAt': datetime.now(timezone.utc).isoformat(), 'binding': cloud.binding, 'workspaceId': receipt['workspaceId'],
            'users': [{key: user[key] for key in ('username', 'role', 'sub')} for user in receipt['users']],
            'verifiedAbsent': ['exact Cognito users', 'exact USER memberships', 'WORKSPACE partition', 'results workspace prefix', 'local identities.json'],
            'mutationScope': 'Only receipt-bound synthetic users, exact keys and exact results prefix; no owner, IAM or group creation/update requests.'}
        save(path.parent / 'cleanup-receipt.json', archive)
        return {'status': 'CLEANED', 'receipt': str(path.parent / 'cleanup-receipt.json')}
    except BaseException:
        receipt['status'] = 'CLEANUP_INCOMPLETE'
        save(path, receipt)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('action', choices=('create', 'cleanup'))
    parser.add_argument('--run-id', help='Exactly 12 lowercase hex digits; required for create.')
    parser.add_argument('--receipt', type=Path, help='Exact ignored .runtime/qa-operators-<id>/receipt.json path; required for cleanup.')
    parser.add_argument('--apply', action='store_true', help='Mutate only the reviewed synthetic targets; otherwise read-only preflight.')
    args = parser.parse_args()
    try:
        if args.action == 'create':
            require(args.run_id and not args.receipt, 'create-arguments-invalid')
            local_dir(args.run_id)  # Validate local arguments before constructing an AWS client.
        else:
            require(args.receipt and not args.run_id, 'cleanup-arguments-invalid')
            args.receipt = args.receipt.absolute()
            require(args.receipt.resolve() == args.receipt and args.receipt.name == 'receipt.json' and args.receipt.parent.parent == BASE
                and re.fullmatch(r'qa-operators-[a-f0-9]{12}', args.receipt.parent.name)
                and not args.receipt.is_symlink() and args.receipt.stat().st_size <= 32768, 'invalid-receipt-path')
            value = json.loads(args.receipt.read_text(encoding='utf-8'))
            validate_receipt(value, args.receipt)
        cloud = Cloud()
        outcome = create(cloud, args.run_id, args.apply) if args.action == 'create' else cleanup(cloud, args.receipt, args.apply)
        print(json.dumps(outcome, indent=2))
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch(r'[a-z0-9-]{1,80}', str(error)) else type(error).__name__
        print(f'FAIL qa-operators: {code}. Preserve any private receipt; review AWS state before retrying.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
