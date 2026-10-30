"""Owner-only original narration, with an explicit finite character allowance.

Produces owned Polly audio, never Location responses. SDK retries are disabled;
each attempt is reserved in the local receipt before synthesis. No credentials
or audio bodies are printed. Run only after freezing the actual app release.
"""
import argparse,datetime,hashlib,html,json,pathlib,re,subprocess
import boto3
from botocore.config import Config

def run(args):
    if not re.fullmatch(r'[a-f0-9]{40}',args.release): raise RuntimeError('A full frozen source SHA is required')
    code="import {BEATS} from './tools/demo/beats.mjs'; process.stdout.write(JSON.stringify(BEATS));"
    beats=json.loads(subprocess.check_output(['node','--input-type=module','-e',code]))
    if args.beat!='all' and args.beat not in [b['id'] for b in beats]: raise RuntimeError('Unknown beat')
    session=boto3.Session(profile_name='default',region_name='eu-west-1')
    if session.client('sts').get_caller_identity()['Account']!='308857099262': raise RuntimeError('Wrong AWS account')
    client=session.client('polly',config=Config(retries={'max_attempts':0},read_timeout=45))
    voices=client.describe_voices(Engine='neural')['Voices']
    if not any(v['Id']=='Joanna' for v in voices): raise RuntimeError('Expected neural voice is unavailable')
    output=pathlib.Path('.runtime/voice')/args.release;output.mkdir(parents=True,exist_ok=True)
    receipt_path=output/'receipt.json'
    receipt=json.loads(receipt_path.read_text(encoding='utf-8')) if receipt_path.exists() else {'release':args.release,'reservedCharacters':0,'attempts':[]}
    if receipt['release']!=args.release: raise RuntimeError('Receipt release mismatch')
    for beat in beats:
        if args.beat not in ['all',beat['id']]: continue
        path=output/(beat['id']+'.mp3')
        if path.exists() and not args.replace:
            print('SKIP existing narration '+beat['id']);continue
        text=beat['narration'];characters=len(text)
        if receipt['reservedCharacters']+characters>6000: raise RuntimeError('The finite 6000-character narration allowance is exhausted')
        attempt={'beat':beat['id'],'charactersReserved':characters,'ratePercent':args.rate,'status':'RESERVED','at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        receipt['reservedCharacters']+=characters;receipt['attempts'].append(attempt)
        receipt_path.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
        response=client.synthesize_speech(Engine='neural',VoiceId='Joanna',OutputFormat='mp3',SampleRate='24000',TextType='ssml',
            Text=f'<speak><prosody rate="{args.rate}%">{html.escape(text)}</prosody></speak>')
        audio=response['AudioStream'].read();path.write_bytes(audio)
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-of','json',str(path)]))
        duration=float(probe['format']['duration'])
        attempt.update({'status':'SUCCEEDED' if duration<=beat['seconds']-.1 else 'OVERLONG','durationSeconds':duration,
            'sha256':hashlib.sha256(audio).hexdigest(),'requestCharacters':response.get('RequestCharacters'),
            'estimatedUsd':characters*.000016})
        receipt_path.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({k:attempt[k] for k in ['beat','status','durationSeconds','charactersReserved','estimatedUsd']}))
        if duration>beat['seconds']-.1: raise RuntimeError('Narration exceeds this beat; explicitly regenerate only that beat at a faster rate')
    print('Narration directory: '+str(output))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--release',required=True);parser.add_argument('--beat',default='all')
    parser.add_argument('--replace',action='store_true');parser.add_argument('--rate',type=int,choices=[90,100,110,120],default=100)
    run(parser.parse_args())
