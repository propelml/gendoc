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

import * as ts from "typescript";
import * as assert from "assert";
import * as path from "path";
import { ArgEntry, DocEntry } from "./types";

function skipAlias(symbol: ts.Symbol, checker: ts.TypeChecker) {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

const debug = false;
function log(...args: Array<string | number>): void {
  if (debug) {
    console.log(...args);
  }
}

export class Parser {
  readonly visitHistory = new Map<ts.Symbol, boolean>();
  readonly visitQueue: ts.Node[] = [];
  readonly output: DocEntry[] = [];
  private checker: ts.TypeChecker = null;

  constructor(readonly tsconfig: ts.CompilerOptions) {}

  /** Generate documentation for all classes in a set of .ts files */
  gen(rootFile: string): DocEntry[] {
    // Build a program using the set of root file names in fileNames
    const program = ts.createProgram([rootFile], this.tsconfig);

    // Get the checker, we will use it to find more about classes
    this.checker = program.getTypeChecker();

    // Find the SourceFile object corresponding to our rootFile.
    let rootSourceFile = null;
    for (const sourceFile of program.getSourceFiles()) {
      if (path.resolve(sourceFile.fileName) === path.resolve(rootFile)) {
        rootSourceFile = sourceFile;
        break;
      }
    }
    assert(rootSourceFile);

    // Add all exported symbols of root module to visitQueue.
    const moduleSymbol = this.checker.getSymbolAtLocation(rootSourceFile);
    for (const s of this.checker.getExportsOfModule(moduleSymbol)) {
      this.requestVisit(s);
    }

    // Process queue of Nodes that should be displayed in docs.
    while (this.visitQueue.length) {
      const n = this.visitQueue.shift();
      this.visit(n);
    }
    return this.output;
  }

  requestVisit(s: ts.Symbol) {
    const exclude = this.tsconfig.exclude as string[];
    if (!this.visitHistory.has(s)) {
      // Find original symbol (might not be in api.ts).
      s = skipAlias(s, this.checker);
      log("requestVisit", s.getName());
      const decls = s.getDeclarations();
      // What does it mean to have multiple declarations?
      // assert(decls.length === 1);
      const sourceFileName = decls[0].getSourceFile().fileName;
      // Dont visit if sourceFileName is in tsconfig excludes
      if (!exclude || !exclude.some(matchesSourceFileName)) {
        this.visitQueue.push(decls[0]);
        this.visitHistory.set(s, true);
      } else {
        log("excluded", sourceFileName);
      }

      function matchesSourceFileName(excludeDir: string) {
        // Replace is used for cross-platform compatibility
        // as 'getSourceFile().fileName' returns posix path
        const excludePath = path.resolve(__dirname, "..", excludeDir);
        const posixExcludePath = excludePath.replace(/\\/g, "/");
        return sourceFileName.includes(posixExcludePath);
      }
    }
  }

  requestVisitType(t: ts.Type) {
    if (t.symbol) {
      this.requestVisit(t.symbol);
    } else if (t.aliasSymbol) {
      this.requestVisit(t.aliasSymbol);
    }
  }

  // visit nodes finding exported classes
  visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name) {
      // This is a top level class, get its symbol
      this.visitClass(node);
    } else if (ts.isTypeAliasDeclaration(node)) {
      // const symbol = checker.getSymbolAtLocation(node.name);
      // checker.typeToString
      // checker.symbolToString
      // console.error("- type alias", checker.typeToString(node.type));
      // console.error(""); // New Line.
    } else if (ts.isStringLiteral(node)) {
      log("- string literal");
    } else if (ts.isVariableDeclaration(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      const name = symbol.getName();
      if (ts.isFunctionLike(node.initializer)) {
        this.visitMethod(node.initializer, name);
      } else {
        log("- var", name);
      }
    } else if (ts.isFunctionDeclaration(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      this.visitMethod(node, symbol.getName());
    } else if (ts.isFunctionTypeNode(node)) {
      log("- FunctionTypeNode.. ?");
    } else if (ts.isFunctionExpression(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.name);
      const name = symbol ? symbol.getName() : "<unknown>";
      log("- FunctionExpression", name);
    } else if (ts.isInterfaceDeclaration(node)) {
      this.visitClass(node);
    } else if (ts.isObjectLiteralExpression(node)) {
      // TODO Ignoring for now.
      log("- ObjectLiteralExpression");
    } else if (ts.isTypeLiteralNode(node)) {
      // TODO Ignoring for now.
      log("- TypeLiteral");
    } else {
      log("Unknown node", node.kind);
      assert(false, "Unknown node");
    }
  }

  visitMethod(
    methodNode: ts.FunctionLike,
    methodName: string,
    className?: string,
  ) {
    // Get the documentation string.
    const sym = this.checker.getSymbolAtLocation(methodNode.name);
    const docstr = this.getFlatDocstr(sym);

    const sig = this.checker.getSignatureFromDeclaration(methodNode);
    const sigStr = this.checker.signatureToString(sig);
    let name;
    if (!className) {
      name = methodName;
    } else if (methodName.startsWith("[")) {
      // EG [Symbol.iterator]
      name = className + methodName;
    } else {
      name = `${className}.${methodName}`;
    }

    // Print each of the parameters.
    const argEntries: ArgEntry[] = [];
    for (const paramSymbol of sig.parameters) {
      const paramType = this.checker.getTypeOfSymbolAtLocation(
        paramSymbol,
        paramSymbol.valueDeclaration!,
      );
      this.requestVisitType(paramType);

      argEntries.push({
        name: paramSymbol.getName(),
        typestr: this.checker.typeToString(paramType),
        docstr: this.getFlatDocstr(paramSymbol),
      });
    }

    const retType = sig.getReturnType();
    this.requestVisitType(retType);

    this.output.push({
      name,
      kind: "method",
      typestr: sigStr,
      args: argEntries,
      retType: this.checker.typeToString(retType),
      docstr,
      // sourceUrl: getSourceUrl(methodNode)
    });
  }

  getFlatDocstr(sym: ts.Symbol): string | undefined {
    if (sym && sym.getDocumentationComment(this.checker).length > 0) {
      return ts.displayPartsToString(sym.getDocumentationComment(this.checker));
    }
    return undefined;
  }

  visitClass(node: ts.ClassDeclaration | ts.InterfaceDeclaration) {
    const symbol = this.checker.getSymbolAtLocation(node.name);
    const className = symbol.getName();

    let docstr = null;
    if (symbol.getDocumentationComment(this.checker).length > 0) {
      docstr = ts.displayPartsToString(
        symbol.getDocumentationComment(this.checker),
      );
    }
    this.output.push({
      name: className,
      kind: "class",
      docstr,
      // sourceUrl: getSourceUrl(node)
    });

    for (const m of node.members) {
      const name = this.classElementName(m);

      // Skip private members.
      if (ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Private) {
        log("private. skipping", name);
        continue;
      }

      if (ts.isPropertySignature(m)) {
        this.visitProp(m, name, className);
      } else if (ts.isMethodSignature(m)) {
        this.visitMethod(m, name, className);
      } else if (ts.isConstructorDeclaration(m)) {
        this.visitMethod(m, "constructor", className);
      } else if (ts.isMethodDeclaration(m)) {
        this.visitMethod(m, name, className);
      } else if (ts.isPropertyDeclaration(m)) {
        if (ts.isFunctionLike(m.initializer)) {
          this.visitMethod(m.initializer, name, className);
        } else {
          this.visitProp(m, name, className);
        }
      } else if (ts.isGetAccessorDeclaration(m)) {
        this.visitProp(m, name, className);
      } else {
        log("member", className, name);
      }
    }
  }

  visitProp(
    node: ts.ClassElement | ts.PropertySignature,
    name: string,
    className?: string,
  ) {
    name = className ? `${className}.${name}` : name;

    const symbol = this.checker.getSymbolAtLocation(node.name);
    const t = this.checker.getTypeOfSymbolAtLocation(symbol, node);

    this.output.push({
      name,
      kind: "property",
      typestr: this.checker.typeToString(t),
      docstr: this.getFlatDocstr(symbol),
      // sourceUrl: getSourceUrl(node)
    });
  }

  classElementName(m: ts.ClassElement | ts.TypeElement): string {
    if (m.name) {
      if (ts.isIdentifier(m.name)) {
        return ts.idText(m.name);
      }
      if (ts.isComputedPropertyName(m.name)) {
        const e = m.name.expression;
        if (ts.isPropertyAccessExpression(e)) {
          // This is for [Symbol.iterator]() { }
          assert(ts.isIdentifier(e.name));
          return `[Symbol.${e.name.text}]`;
        }
      }
    }
    return "<unknown>";
  }
}
