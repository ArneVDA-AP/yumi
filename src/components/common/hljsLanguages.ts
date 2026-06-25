// Curated highlight.js language set. Registering only the languages a coding
// tool actually encounters keeps the bundle far smaller than `lib/common`
// (which ships ~37 grammars) while still covering everything relevant.

import type { HLJSApi } from "highlight.js";

import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import markdown from "highlight.js/lib/languages/markdown";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml"; // html
import diff from "highlight.js/lib/languages/diff";
import sql from "highlight.js/lib/languages/sql";
import toml from "highlight.js/lib/languages/ini"; // toml ≈ ini grammar
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import java from "highlight.js/lib/languages/java";

let registered = false;

export function registerLanguages(hljs: HLJSApi): void {
  if (registered) return;
  registered = true;
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("yaml", yaml);
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("shell", shell);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("html", xml);
  hljs.registerLanguage("diff", diff);
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("toml", toml);
  hljs.registerLanguage("ini", toml);
  hljs.registerLanguage("c", c);
  hljs.registerLanguage("cpp", cpp);
  hljs.registerLanguage("java", java);

  // Common aliases so language hints from markdown fences resolve.
  hljs.registerLanguage("ts", typescript);
  hljs.registerLanguage("js", javascript);
  hljs.registerLanguage("py", python);
  hljs.registerLanguage("rs", rust);
  hljs.registerLanguage("sh", bash);
}
