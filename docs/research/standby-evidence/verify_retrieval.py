"""Exercise evidence retrieval, abstention and fail-closed metadata checks offline.

Smoke checks on a curated research index, not a retrieval-accuracy benchmark and
not validation of an operational forecasting or staffing model.
"""
import argparse
import json
from pathlib import Path
import tempfile
from retrieve import ROOT, digest, load, retrieve

def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    entries=load(ROOT/'sources.jsonl')
    questions=json.loads((ROOT/'questions.json').read_text(encoding='utf-8'))
    contexts=[retrieve(entries,q,5) for q in questions]
    (ROOT/'retrieval-contexts.json').write_text(json.dumps(contexts,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    expected={1:'D01',3:'M04',7:'D07',8:'D06',9:'L01',10:'D05'}
    checks=[]
    for index,source in expected.items():
        ids=[x['id'] for x in contexts[index]['results']]
        assert source in ids,(index+1,source,ids)
        checks.append({'check':'representative source recall','question':index+1,'expectedSource':source,'pass':True})
    assert not contexts[-1]['results']
    checks.append({'check':'unrelated question returns no evidence','pass':True})
    direct=retrieve(entries,'capacity workload service simulation',20,direct_only=True)
    assert all(x['transfer']!='analogue' for x in direct['results'])
    checks.append({'check':'explicit cross-domain analogue filter','pass':True})
    study=retrieve(entries,'dispatch roadside simulation',20,kind='study')
    assert study['results'] and all(x['kind']=='study' for x in study['results'])
    checks.append({'check':'study-kind filter','pass':True})
    with tempfile.TemporaryDirectory(prefix='retrieval-check-',dir=ROOT) as folder:
        fixture=Path(folder)/'bad.jsonl'
        for label,mutate in (
            ('tampered record hash',lambda r:r.update(evidence='changed without rehash')),
            ('private record rejected',lambda r:(r.update(visibility='PRIVATE'),r.update(recordSha256=digest(r)))),
            ('shipped-status mismatch rejected',lambda r:(r.update(featureStatus='SHIPPED'),r.update(recordSha256=digest(r)))),
        ):
            record=dict(entries[0]); mutate(record)
            fixture.write_text(json.dumps(record,ensure_ascii=False)+'\n',encoding='utf-8')
            rejected=False
            try:
                load(fixture)
            except ValueError:
                rejected=True
            assert rejected,label
            checks.append({'check':label,'pass':True})
    receipt={'date':'2026-10-30','sourceRecords':len(entries),'questions':len(questions),
             'checks':checks,'result':'PASS','externalCalls':0,
             'limits':'Curated-note smoke checks only; no independent retrieval quality score or staffing/forecast validation'}
    (ROOT/'verification.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'result':'PASS','sources':len(entries),'questions':len(questions),'checks':len(checks),'externalCalls':0}))

if __name__=='__main__':
    main()
