"""Local, citation-preserving lexical retrieval for the Standby research corpus.

No network, embeddings, LLM calls or third-party packages. The language model's
research synthesis uses the returned evidence and limitations. This script only
retrieves curated paraphrases; it does not forecast demand or recommend staffing.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parent
STOP = set('the a an of for and or to in on with is are as from by this that what can do does how we our it be not at than its has have into using why standby και το τα τη την της των σε με για απο που ειναι πως τι να εχει εχουμε μας δεν'.split())
ALIASES = {
    'στολ': 'fleet units capacity', 'μοναδ': 'units fleet capacity',
    'επαρκ': 'capacity staffing queues workload', 'ταυτοχρον': 'concurrency queue busy',
    'ουρ': 'queue waiting dispatch', 'βραδ': 'night shifts time',
    'νυχτ': 'night shifts time', 'αργ': 'holidays calendar demand',
    'χριστουγενν': 'holidays calendar demand', 'ημερολογ': 'calendar holidays dates',
    'καιρ': 'weather rainfall temperature wind', 'βροχ': 'weather rainfall',
    'ανεμ': 'weather wind', 'διαρκ': 'duration service busy timestamps',
    'χρονο': 'time duration service', 'εξυπηρετ': 'service duration',
    'μηχαν': 'motorcycle heterogeneous capability fleet',
    'πλατφορμ': 'flatbed towing capability heterogeneous',
    'ανωμαλ': 'anomaly baseline quality missing',
    'προβλεψ': 'forecast demand validation', 'ζήτησ': 'demand forecast',
    'ζητησ': 'demand forecast', 'θεσ': 'location placement staging',
    'περιπολ': 'patrol staging relocation', 'χωροθετ': 'location coverage staging',
    'μελετ': 'study research methods', 'ανταγωνισ': 'market dispatch vendor',
    'ραγ': 'rag retrieval citations evidence',
}

def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.lower())
                   if unicodedata.category(c) != 'Mn')

def tokens(value):
    return [t for t in re.findall(r'[^\W_]+', normalize(value), flags=re.UNICODE)
            if len(t) > 1 and t not in STOP]

def digest(record):
    value = {k:v for k,v in record.items() if k != 'recordSha256'}
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()

def load(path):
    entries = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
    seen = set()
    for row in entries:
        for field in ('id','title','url','publisher','kind','accessLevel','accessedOn','evidence','limitations','application','tags','recordSha256'):
            if not row.get(field):
                raise ValueError(f"{row.get('id','unknown')}: missing {field}")
        if row['id'] in seen:
            raise ValueError(f"Duplicate source: {row['id']}")
        seen.add(row['id'])
        if not row['url'].startswith('https://'):
            raise ValueError(f"{row['id']}: canonical HTTPS citation required")
        if row['recordSha256'] != digest(row):
            raise ValueError(f"{row['id']}: record hash mismatch")
        if row.get('visibility') != 'PUBLIC' or row.get('featureStatus') != 'RESEARCH_ONLY':
            raise ValueError(f"{row['id']}: this bounded research index accepts PUBLIC/RESEARCH_ONLY records")
    if not entries:
        raise ValueError('Empty corpus')
    return entries

def retrieve(entries, query, limit=5, kind=None, direct_only=False):
    query_terms = tokens(query)
    expanded = list(query_terms)
    for term in query_terms:
        for prefix, synonyms in ALIASES.items():
            if term.startswith(normalize(prefix)):
                expanded.extend(tokens(synonyms))
    query_terms = set(expanded)
    docs = [tokens(' '.join([r['title'],r['evidence'],r['limitations'],r['application'],' '.join(r['tags'])])) for r in entries]
    n = len(docs)
    avg = sum(map(len,docs))/n
    df = Counter(t for terms in docs for t in set(terms))
    ranked=[]
    for row,terms in zip(entries,docs):
        if kind and row['kind'] != kind:
            continue
        if direct_only and row.get('transfer') == 'analogue':
            continue
        counts=Counter(terms)
        score=0.0
        for term in query_terms:
            if counts[term]:
                idf=math.log(1+(n-df[term]+0.5)/(df[term]+0.5))
                f=counts[term]
                score += idf*f*2.2/(f+1.2*(0.25+0.75*len(terms)/avg))
        if score > 0:
            ranked.append({**row,'retrievalScore':round(score,6)})
    ranked.sort(key=lambda r:(-r['retrievalScore'],r['id']))
    return {'query':query,'mode':'local BM25-style lexical retrieval with explicit Greek aliases',
            'corpusSize':n,'answerStatus':'evidence available' if ranked else 'no matching evidence; abstain',
            'results':ranked[:limit]}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('query',nargs='?',help='Greek or English research question')
    parser.add_argument('--corpus',type=Path,default=ROOT/'sources.jsonl')
    parser.add_argument('--top',type=int,default=5)
    parser.add_argument('--kind',choices=['market','study','data','method','platform'])
    parser.add_argument('--direct-only',action='store_true',help='Exclude explicitly labelled cross-domain analogues')
    parser.add_argument('--validate',action='store_true',help='Validate all required metadata and curated-record hashes')
    parser.add_argument('--batch',type=Path,help='UTF-8 JSON array of question strings; returns retrieval contexts')
    args=parser.parse_args()
    if not 1 <= args.top <= 20:
        parser.error('--top must be between1 and20')
    entries=load(args.corpus)
    if args.validate:
        print(json.dumps({'valid':True,'sources':len(entries),'kinds':dict(Counter(x['kind'] for x in entries)),
                          'hashScope':'curated metadata/paraphrase records, not remote full-text documents'},ensure_ascii=False,indent=2))
        return
    if args.batch:
        questions=json.loads(args.batch.read_text(encoding='utf-8'))
        if not isinstance(questions,list) or not all(isinstance(x,str) for x in questions):
            raise ValueError('--batch must contain a JSON array of strings')
        value=[retrieve(entries,q,args.top,args.kind,args.direct_only) for q in questions]
    elif args.query:
        value=retrieve(entries,args.query,args.top,args.kind,args.direct_only)
    else:
        parser.error('Provide a query, --batch or --validate')
    print(json.dumps(value,ensure_ascii=False,indent=2))

if __name__ == '__main__':
    main()
