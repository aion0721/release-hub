import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dataDir = resolve(process.env.DATA_DIR || "data");
const sourceFile = resolve(dataDir, process.argv[2] || "release.json");
const targetFile = resolve(dataDir, process.argv[3] || "releases.json");

const source = JSON.parse(await readFile(sourceFile, "utf8"));
const works = Array.isArray(source) ? source : Array.isArray(source.releases) ? source.releases : source.release ? [source] : [];
const records = works.map((work, index) => {
  const id = Number(work.id || work.release?.id || index + 1);
  return { ...work, id, release: { ...work.release, id } };
});

await mkdir(dataDir, { recursive: true });
await writeFile(targetFile, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(`Migrated ${records.length} release work(s): ${sourceFile} -> ${targetFile}`);
