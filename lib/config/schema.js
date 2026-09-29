/**
 * Config file JSON Schema validation.
 */
import {Ajv} from 'ajv';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_DIR = path.join(import.meta.dirname, '..', '..', 'schemas');

function loadSchema(name) {
  return JSON.parse(
    fs.readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'));
}

const ajv = new Ajv({allErrors: true, strict: true, strictRequired: false});

const validators = {
  workspace: ajv.compile(loadSchema('workspace')),
  group: ajv.compile(loadSchema('group'))
};

/**
 * Validate config data against a schema.
 *
 * @param {'workspace'|'group'} kind - Which schema to use.
 * @param {*} data - Parsed config data.
 *
 * @returns {string[]} Human readable error messages, empty if valid.
 */
export function validateConfig(kind, data) {
  const validate = validators[kind];
  if(validate(data)) {
    return [];
  }
  return formatErrors(validate.errors);
}

function formatErrors(errors) {
  // `oneOf` failures produce an error for every branch plus a summary. Keep
  // the most specific errors: drop summaries, drop type mismatches when the
  // branch with the right type reported something more specific, and merge
  // the remaining type mismatches for the same value.
  const isSpecific = e => !['type', 'oneOf', 'anyOf'].includes(e.keyword);
  const specific = errors.filter(e => isSpecific(e));
  const typesByPath = new Map();
  for(const error of errors.filter(e => e.keyword === 'type')) {
    const at = error.instancePath;
    const explained = errors.some(o =>
      !['oneOf', 'anyOf'].includes(o.keyword) &&
      (o.instancePath.startsWith(`${at}/`) ||
      o.instancePath === at && o.keyword !== 'type'));
    if(!explained) {
      const types = typesByPath.get(at) ?? [];
      types.push(error.params.type);
      typesByPath.set(at, types);
    }
  }

  const messages = [];
  for(const [at, types] of typesByPath) {
    messages.push([at, `must be ${types.join(' or ')}`]);
  }
  for(const error of specific) {
    const where = error.instancePath;
    let message = error.message;
    if(error.keyword === 'required' && errors.some(o =>
      o !== error && o.keyword === 'required' &&
      o.instancePath === error.instancePath)) {
      // anyOf of required properties
      const names = errors
        .filter(o => o.keyword === 'required' &&
          o.instancePath === error.instancePath)
        .map(o => `"${o.params.missingProperty}"`);
      message = `must have property ${names.join(' or ')}`;
    } else if(error.keyword === 'additionalProperties') {
      message = `unknown property "${error.params.additionalProperty}"`;
    } else if(error.keyword === 'enum') {
      message = `must be one of: ${error.params.allowedValues.join(', ')}`;
    } else if(error.keyword === 'const') {
      message = `must be ${JSON.stringify(error.params.allowedValue)}`;
    }
    messages.push([where, message]);
  }
  // sort by location, top level first, array indexes numerically
  messages.sort(([a], [b]) => a.localeCompare(b, 'en', {numeric: true}));
  return [...new Set(messages.map(
    ([where, message]) => `${where || '(top level)'}: ${message}`))];
}
