import argparse,contextlib,importlib.util,io,json,pathlib,tempfile,unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('matrix_builder',pathlib.Path(__file__).with_name('build-matrix.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class FakeClient:
    def __init__(self,response):self.response=response;self.calls=[];self.saved=None
    def get_caller_identity(self):return {'Account':'308857099262'}
    def describe_stacks(self,**kwargs):return {'Stacks':[{'Outputs':[{'OutputKey':k,'OutputValue':v} for k,v in {'BuilderRoleArn':'arn:synthetic','BuilderControlTable':'control','CacheBucket':'private-cache'}.items()]}]}
    def assume_role(self,**kwargs):return {'Credentials':{'AccessKeyId':'synthetic','SecretAccessKey':'synthetic','SessionToken':'synthetic'}}
    def put_item(self,**kwargs):self.calls.append(('initialize',kwargs))
    def transact_write_items(self,**kwargs):self.calls.append(('reserve',kwargs))
    def calculate_route_matrix(self,**kwargs):self.calls.append(('route',kwargs));return self.response
    def put_object(self,**kwargs):self.calls.append(('save',kwargs['Key']));self.saved=kwargs['Body']
    def get_object(self,**kwargs):return {'Body':io.BytesIO(self.saved)}
    def update_item(self,**kwargs):self.calls.append(('complete',kwargs))
    def client(self,name,**kwargs):return self

class MatrixBuilderTest(unittest.TestCase):
    def invoke(self,response):
        client=FakeClient(response)
        model={'profile':'Car','bounds':[-97.88,30.18,-97.62,30.46],'datasetHash':'synthetic-dataset',
            'origins':[{'id':'site-a','position':[-97.8,30.2]},{'id':'site-b','position':[-97.7,30.3]}],
            'destinations':[{'id':'zone-x','position':[-97.75,30.25]},{'id':'zone-y','position':[-97.72,30.32]}]}
        with tempfile.TemporaryDirectory() as tmp:
            source=pathlib.Path(tmp)/'input.json';source.write_text(json.dumps(model))
            with patch.object(builder.boto3,'Session',return_value=client),patch.object(builder.pathlib.Path,'write_text',return_value=0),contextlib.redirect_stdout(io.StringIO()):
                builder.run(argparse.Namespace(input=str(source),attempt=1))
        return client
    def test_directional_full_pipeline_reserves_before_call_and_keeps_no_route(self):
        client=self.invoke({'PricingBucket':'Core','RouteMatrix':[[{'Duration':11},{'Duration':0,'Error':'NoRoute'}],[{'Duration':777},{'Duration':23}]]})
        value=json.loads(client.saved)
        self.assertEqual(value['durationsSeconds'],[[11,None],[777,23]])
        self.assertEqual(value['siteIds'],['site-a','site-b'])
        self.assertEqual(value['zoneIds'],['zone-x','zone-y'])
        self.assertLess([c[0] for c in client.calls].index('reserve'),[c[0] for c in client.calls].index('route'))
        reserve=next(c[1] for c in client.calls if c[0]=='reserve')['TransactItems']
        self.assertEqual(reserve[0]['Update']['ExpressionAttributeValues'][':pairs']['N'],'4')
        self.assertEqual(reserve[1]['Put']['ConditionExpression'],'attribute_not_exists(pk)')
    def test_unknown_provider_error_fails_without_publishing_partial_matrix(self):
        with self.assertRaisesRegex(RuntimeError,'non-NoRoute'):
            self.invoke({'PricingBucket':'Core','RouteMatrix':[[{'Duration':11},{'Duration':0,'Error':'NoMatchDestination'}],[{'Duration':777},{'Duration':23}]]})
    def test_missing_cells_fail_instead_of_creating_fast_routes(self):
        with self.assertRaisesRegex(RuntimeError,'Incomplete'):
            self.invoke({'PricingBucket':'Core','RouteMatrix':[[{'Duration':11}],[{'Duration':777}]]})

if __name__=='__main__':unittest.main()
