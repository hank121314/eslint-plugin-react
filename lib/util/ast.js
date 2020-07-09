/**
 * @fileoverview Utility functions for AST
 */

'use strict';

const flatMap = require('array.prototype.flatmap');

function isFunctionType(node) {
  const regexp = new RegExp('^(?:Function(?:Declaration|Expression)|ArrowFunctionExpression)$');
  return regexp.test(node.type);
}

function isSupportedBodyType(node) {
  const regexp = new RegExp('^(?:(?:Do)?While|For(?:In|Of)?|If|Expression)Statement$');
  return regexp.test(node.type);
}
/**
 * Find a return statement in the current node
 *
 * @param {ASTNode} node The AST node being checked
 * @param {Context} context of sourceCode
 * @returns {ASTNode | false}
 */
function findJSXReturnStatement(node, context) {
  let bodyNodes = [];
  if (node.type === 'ReturnStatement' || node.type === 'YieldExpression') {
    bodyNodes = [node];
  }
  function loopNodes(bnode) {
    if (!bnode) {
      return false;
    }
    if (bnode.type === 'ReturnStatement' || bnode.type === 'YieldExpression' || isFunctionType(bnode)) {
      let parent = bnode;
      while (parent) {
      // Check bnode is the inner function, like map(()=>{})
        if (isFunctionType(parent) && parent !== node) {
          return false;
        }
        if (parent === node) {
          return bnode;
        }
        parent = parent.parent;
      }
    }
    if (bnode.type === 'ExpressionStatement') {
      return bnode.expression;
    }
    if (bnode.type === 'IfStatement') {
      if (bnode.alternate === null) {
        if (bnode.consequent.type !== 'BlockStatement') {
          return loopNodes(bnode.consequent);
        }
        return false;
      }
      const ifStatements = [];
      if (bnode.consequent.type !== 'BlockStatement') {
        ifStatements.push(bnode.consequent);
      }
      if (bnode.alternate.type !== 'BlockStatement') {
        ifStatements.push(bnode.alternate);
      }
      return flatMap(ifStatements.map(loopNodes), (_) => _).filter((n) => n);
    }
    if (isSupportedBodyType(bnode)) {
      if (bnode.body && bnode.body.type !== 'BlockStatement') return loopNodes(bnode.body);
    }
    if (bnode.type === 'SwitchStatement') {
      return flatMap(bnode.cases.map((switchCase) => {
        if (switchCase.consequent && switchCase.consequent.length !== 0) {
          return flatMap(switchCase.consequent.map(loopNodes), (_) => _);
        }
        return false;
      }), (_) => _).filter((n) => n);
    }
    return false;
  }
  if (isFunctionType(node)) {
    node = node.value ? node.value : node;
    const sourceCode = context.getSourceCode();
    const scopes = sourceCode.scopeManager.scopes;
    bodyNodes = flatMap(scopes.map((scope) => {
      if (scope.type === 'function' && isFunctionType(scope.block)) {
        // @ts-ignore
        if (!scope.block.body.body) {
          // @ts-ignore
          if (typeof scope.block.body === 'object') {
            // @ts-ignore
            return scope.block;
          }
          return null;
        }
        // @ts-ignore
        if (scope.block.body.body.filter) {
          // @ts-ignore
          const retStatement = scope.block.body.body.filter((body) => body.type === 'ReturnStatement' || isSupportedBodyType(body));
          if (retStatement.length !== 0) {
            // @ts-ignore
            if (scope.block.body.body.length === 0) {
              return null;
            }
            return retStatement;
          }
        }
        return null;
      }
      if (scope.type === 'block' && scope.block.type === 'BlockStatement') {
        const retStatement = scope.block.body.filter((body) => 'ReturnStatement' || isSupportedBodyType(body));
        if (retStatement.length !== 0) {
          if (scope.block.body.length === 0) {
            return null;
          }
          return retStatement;
        }
        return null;
      }
      if (scope.type === 'switch' && scope.block.type === 'SwitchStatement') {
        return scope.block;
      }
      // @ts-ignore
      if (scope.type === 'for' && scope.block.body.type !== 'BlockStatement') return scope.block.body;
      return null;
    }).filter((scope) => scope !== null && scope.length !== 0), (_) => _);
  }
  if (bodyNodes) return flatMap(bodyNodes.map(loopNodes), (_) => _);
  return false;
}

/**
 * Find a return statment in the current node
 *
 * @param {ASTNode} node The AST node being checked
 * @returns {ASTNode | false}
 */
function findReturnStatement(node) {
  if (
    (!node.value || !node.value.body || !node.value.body.body)
    && (!node.body || !node.body.body)
  ) {
    return false;
  }

  const bodyNodes = (node.value ? node.value.body.body : node.body.body);

  return (function loopNodes(nodes) {
    let i = nodes.length - 1;
    for (; i >= 0; i--) {
      if (nodes[i].type === 'ReturnStatement') {
        return nodes[i];
      }
      if (nodes[i].type === 'SwitchStatement') {
        let j = nodes[i].cases.length - 1;
        for (; j >= 0; j--) {
          return loopNodes(nodes[i].cases[j].consequent);
        }
      }
    }
    return false;
  }(bodyNodes));
}

/**
 * Get node with property's name
 * @param {Object} node - Property.
 * @returns {Object} Property name node.
 */
function getPropertyNameNode(node) {
  if (node.key || ['MethodDefinition', 'Property'].indexOf(node.type) !== -1) {
    return node.key;
  }
  if (node.type === 'MemberExpression') {
    return node.property;
  }
  return null;
}

/**
 * Get properties name
 * @param {Object} node - Property.
 * @returns {String} Property name.
 */
function getPropertyName(node) {
  const nameNode = getPropertyNameNode(node);
  return nameNode ? nameNode.name : '';
}

/**
 * Get properties for a given AST node
 * @param {ASTNode} node The AST node being checked.
 * @returns {Array} Properties array.
 */
function getComponentProperties(node) {
  switch (node.type) {
    case 'ClassDeclaration':
    case 'ClassExpression':
      return node.body.body;
    case 'ObjectExpression':
      return node.properties;
    default:
      return [];
  }
}

/**
 * Gets the first node in a line from the initial node, excluding whitespace.
 * @param {Object} context The node to check
 * @param {ASTNode} node The node to check
 * @return {ASTNode} the first node in the line
 */
function getFirstNodeInLine(context, node) {
  const sourceCode = context.getSourceCode();
  let token = node;
  let lines;
  do {
    token = sourceCode.getTokenBefore(token);
    lines = token.type === 'JSXText'
      ? token.value.split('\n')
      : null;
  } while (
    token.type === 'JSXText'
        && /^\s*$/.test(lines[lines.length - 1])
  );
  return token;
}

/**
 * Checks if the node is the first in its line, excluding whitespace.
 * @param {Object} context The node to check
 * @param {ASTNode} node The node to check
 * @return {Boolean} true if it's the first node in its line
 */
function isNodeFirstInLine(context, node) {
  const token = getFirstNodeInLine(context, node);
  const startLine = node.loc.start.line;
  const endLine = token ? token.loc.end.line : -1;
  return startLine !== endLine;
}

/**
 * Checks if the node is a function or arrow function expression.
 * @param {ASTNode} node The node to check
 * @return {Boolean} true if it's a function-like expression
 */
function isFunctionLikeExpression(node) {
  return node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
}

/**
 * Checks if the node is a function.
 * @param {ASTNode} node The node to check
 * @return {Boolean} true if it's a function
 */
function isFunction(node) {
  return node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration';
}

/**
 * Checks if the node is a class.
 * @param {ASTNode} node The node to check
 * @return {Boolean} true if it's a class
 */
function isClass(node) {
  return node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
}

/**
 * Removes quotes from around an identifier.
 * @param {string} string the identifier to strip
 * @returns {string}
 */
function stripQuotes(string) {
  return string.replace(/^'|'$/g, '');
}

/**
 * Retrieve the name of a key node
 * @param {Context} context The AST node with the key.
 * @param {ASTNode} node The AST node with the key.
 * @return {string | undefined} the name of the key
 */
function getKeyValue(context, node) {
  if (node.type === 'ObjectTypeProperty') {
    const tokens = context.getFirstTokens(node, 2);
    return (tokens[0].value === '+' || tokens[0].value === '-'
      ? tokens[1].value
      : stripQuotes(tokens[0].value)
    );
  }
  if (node.type === 'GenericTypeAnnotation') {
    return node.id.name;
  }
  if (node.type === 'ObjectTypeAnnotation') {
    return;
  }
  const key = node.key || node.argument;
  if (!key) {
    return;
  }
  return key.type === 'Identifier' ? key.name : key.value;
}

/**
 * Checks if a node is being assigned a value: props.bar = 'bar'
 * @param {ASTNode} node The AST node being checked.
 * @returns {Boolean}
 */
function isAssignmentLHS(node) {
  return (
    node.parent
    && node.parent.type === 'AssignmentExpression'
    && node.parent.left === node
  );
}

/**
 * Extracts the expression node that is wrapped inside a TS type assertion
 *
 * @param {ASTNode} node - potential TS node
 * @returns {ASTNode} - unwrapped expression node
 */
function unwrapTSAsExpression(node) {
  if (node && node.type === 'TSAsExpression') return node.expression;
  return node;
}

module.exports = {
  findReturnStatement,
  findJSXReturnStatement,
  getFirstNodeInLine,
  getPropertyName,
  getPropertyNameNode,
  getComponentProperties,
  getKeyValue,
  isAssignmentLHS,
  isClass,
  isFunction,
  isFunctionLikeExpression,
  isNodeFirstInLine,
  unwrapTSAsExpression
};
