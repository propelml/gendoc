/*!
Copyright 2018 Propel http://propel.site/.  All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/* A custom AST walker for documentation. This was written because
 - TypeDoc is unable to generate documentation for a single exported module, as
   we have with api.ts,
 - TypeDoc has an unreasonable amount of dependencies and code,
 - we want very nice looking documentation without superfluous junk. This gives
   full control.
*/
// tslint:disable:object-literal-sort-keys
import * as fs from "fs";
import { DocEntry } from "./types";
import { Parser } from "./parser";

export function genJSON(targetFn: string): DocEntry[] {
  // Global variables.

  const parser = new Parser(require("./tsconfig.json"));
  return parser.gen(targetFn);
}

export function writeJSON(inputSource: string, outputJson: string): void {
  const docs = genJSON(inputSource);
  const j = JSON.stringify(docs, null, 2);
  fs.writeFileSync(outputJson, j);
  console.log("wrote", outputJson);
}

if (require.main === module) {
  const inputSource = process.argv[2];
  const outputJson = process.argv[3];
  if (!inputSource || !outputJson) {
    console.log("Usage: ts-node gendoc.ts ./input.ts ./output.json");
    process.exit(1);
  }
  writeJSON(inputSource, outputJson);
}
