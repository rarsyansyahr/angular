/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AST, ASTWithSource, AstPath as AstPathBase, RecursiveAstVisitor} from '@angular/compiler';
import {AstType} from './expression_type';
import {BuiltinType, Span, Symbol, SymbolTable, TemplateSource} from './types';
import {inSpan} from './utils';

type AstPath = AstPathBase<AST>;

function findAstAt(ast: AST, position: number, excludeEmpty: boolean = false): AstPath {
  const path: AST[] = [];
  const visitor = new class extends RecursiveAstVisitor {
    visit(ast: AST) {
      if ((!excludeEmpty || ast.sourceSpan.start < ast.sourceSpan.end) &&
          inSpan(position, ast.sourceSpan)) {
        path.push(ast);
        ast.visit(this);
      }
    }
  };

  // We never care about the ASTWithSource node and its visit() method calls its ast's visit so
  // the visit() method above would never see it.
  if (ast instanceof ASTWithSource) {
    ast = ast.ast;
  }

  visitor.visit(ast);

  return new AstPathBase<AST>(path, position);
}

export function getExpressionCompletions(
    scope: SymbolTable, ast: AST, position: number, templateInfo: TemplateSource): Symbol[]|
    undefined {
  const path = findAstAt(ast, position);
  if (path.empty) return undefined;
  const tail = path.tail !;
  let result: SymbolTable|undefined = scope;

  function getType(ast: AST): Symbol {
    return new AstType(scope, templateInfo.query, {}, templateInfo.source).getType(ast);
  }

  // If the completion request is in a not in a pipe or property access then the global scope
  // (that is the scope of the implicit receiver) is the right scope as the user is typing the
  // beginning of an expression.
  tail.visit({
    visitBinary(ast) {},
    visitChain(ast) {},
    visitConditional(ast) {},
    visitFunctionCall(ast) {},
    visitImplicitReceiver(ast) {},
    visitInterpolation(ast) { result = undefined; },
    visitKeyedRead(ast) {},
    visitKeyedWrite(ast) {},
    visitLiteralArray(ast) {},
    visitLiteralMap(ast) {},
    visitLiteralPrimitive(ast) {},
    visitMethodCall(ast) {},
    visitPipe(ast) {
      if (position >= ast.exp.span.end &&
          (!ast.args || !ast.args.length || position < (<AST>ast.args[0]).span.start)) {
        // We are in a position a pipe name is expected.
        result = templateInfo.query.getPipes();
      }
    },
    visitPrefixNot(ast) {},
    visitNonNullAssert(ast) {},
    visitPropertyRead(ast) {
      const receiverType = getType(ast.receiver);
      result = receiverType ? receiverType.members() : scope;
    },
    visitPropertyWrite(ast) {
      const receiverType = getType(ast.receiver);
      result = receiverType ? receiverType.members() : scope;
    },
    visitQuote(ast) {
      // For a quote, return the members of any (if there are any).
      result = templateInfo.query.getBuiltinType(BuiltinType.Any).members();
    },
    visitSafeMethodCall(ast) {
      const receiverType = getType(ast.receiver);
      result = receiverType ? receiverType.members() : scope;
    },
    visitSafePropertyRead(ast) {
      const receiverType = getType(ast.receiver);
      result = receiverType ? receiverType.members() : scope;
    },
  });

  return result && result.values();
}

/**
 * Retrieves the expression symbol at a particular position in a template.
 *
 * @param scope symbols in scope of the template
 * @param ast template AST
 * @param position absolute location in template to retrieve symbol at
 * @param query type symbol query for the template scope
 */
export function getExpressionSymbol(
    scope: SymbolTable, ast: AST, position: number,
    templateInfo: TemplateSource): {symbol: Symbol, span: Span}|undefined {
  const path = findAstAt(ast, position, /* excludeEmpty */ true);
  if (path.empty) return undefined;
  const tail = path.tail !;

  function getType(ast: AST): Symbol {
    return new AstType(scope, templateInfo.query, {}, templateInfo.source).getType(ast);
  }

  let symbol: Symbol|undefined = undefined;
  let span: Span|undefined = undefined;

  // If the completion request is in a not in a pipe or property access then the global scope
  // (that is the scope of the implicit receiver) is the right scope as the user is typing the
  // beginning of an expression.
  tail.visit({
    visitBinary(ast) {},
    visitChain(ast) {},
    visitConditional(ast) {},
    visitFunctionCall(ast) {},
    visitImplicitReceiver(ast) {},
    visitInterpolation(ast) {},
    visitKeyedRead(ast) {},
    visitKeyedWrite(ast) {},
    visitLiteralArray(ast) {},
    visitLiteralMap(ast) {},
    visitLiteralPrimitive(ast) {},
    visitMethodCall(ast) {
      const receiverType = getType(ast.receiver);
      symbol = receiverType && receiverType.members().get(ast.name);
      span = ast.span;
    },
    visitPipe(ast) {
      if (inSpan(position, ast.nameSpan, /* exclusive */ true)) {
        // We are in a position a pipe name is expected.
        const pipes = templateInfo.query.getPipes();
        symbol = pipes.get(ast.name);

        // `nameSpan` is an absolute span, but the span expected by the result of this method is
        // relative to the start of the expression.
        // TODO(ayazhafiz): migrate to only using absolute spans
        const offset = ast.sourceSpan.start - ast.span.start;
        span = {
          start: ast.nameSpan.start - offset,
          end: ast.nameSpan.end - offset,
        };
      }
    },
    visitPrefixNot(ast) {},
    visitNonNullAssert(ast) {},
    visitPropertyRead(ast) {
      const receiverType = getType(ast.receiver);
      symbol = receiverType && receiverType.members().get(ast.name);
      span = ast.span;
    },
    visitPropertyWrite(ast) {
      const receiverType = getType(ast.receiver);
      const {start} = ast.span;
      symbol = receiverType && receiverType.members().get(ast.name);
      // A PropertyWrite span includes both the LHS (name) and the RHS (value) of the write. In this
      // visit, only the name is relevant.
      //   prop=$event
      //   ^^^^        name
      //        ^^^^^^ value; visited separately as a nested AST
      span = {start, end: start + ast.name.length};
    },
    visitQuote(ast) {},
    visitSafeMethodCall(ast) {
      const receiverType = getType(ast.receiver);
      symbol = receiverType && receiverType.members().get(ast.name);
      span = ast.span;
    },
    visitSafePropertyRead(ast) {
      const receiverType = getType(ast.receiver);
      symbol = receiverType && receiverType.members().get(ast.name);
      span = ast.span;
    },
  });

  if (symbol && span) {
    return {symbol, span};
  }
}
