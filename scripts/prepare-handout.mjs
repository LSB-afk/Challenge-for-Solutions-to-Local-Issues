import { copyFile } from 'node:fs/promises';
const names = ['competition-positioning.md','field-interview-kit.md','regional-validation.md','10_eval-plan.md'];
for (const name of names) await copyFile(new URL(`../docs/${name}`, import.meta.url), new URL(`../dist/${name}`, import.meta.url));
console.log(`제안·인터뷰·자료검증·평가 문서 ${names.length}개 준비`);
