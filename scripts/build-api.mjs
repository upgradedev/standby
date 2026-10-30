import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
for (const name of ['read','writer','retention']) {
  await mkdir(`dist/${name}`, {recursive:true});
  await build({entryPoints:[`services/api/src/${name}.ts`],bundle:true,
    platform:'node',target:'node22',format:'cjs',outfile:`dist/${name}/index.js`,
    minify:true,sourcemap:false,logLevel:'info'});
}
