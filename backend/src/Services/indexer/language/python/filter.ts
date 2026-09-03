/**
 * Python source path filters.
 * Excludes virtual environments, cache directories, packaging output, and test files.
 */

const PYTHON_EXTENSIONS = ['.py', '.pyi'];

const EXCLUDED_PYTHON_DIRECTORIES = [
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  '.venv',
  'venv',
  'env',
  'virtualenv',
  'site-packages',
  'dist',
  'build',
  'egg-info',
  '.eggs',
  '.git',
  '.hg',
  '.svn',
];

const PYTHON_TEST_PATTERNS = [
  /(^|\/)tests?\//,
  /(^|\/)__tests__\//,
  /(^|\/)test_.*\.py$/,
  /.*_test\.py$/,
  /(^|\/)conftest\.py$/,
];

const PYTHON_GENERATED_PATTERNS = [
  /.*_pb2\.py$/,
  /.*_pb2_grpc\.py$/,
];

const hasPythonExtension = (path: string): boolean =>
  PYTHON_EXTENSIONS.some((ext) => path.endsWith(ext));

const inExcludedDirectory = (path: string): boolean => {
  const segments = path.split('/');
  return segments.slice(0, -1).some((segment) =>
    EXCLUDED_PYTHON_DIRECTORIES.some((excluded) => segment === excluded || segment.endsWith('.egg-info'))
  );
};

/** True when a path is a candidate Python source file for indexing. */
export const isPythonSourceFile = (path: string): boolean => {
  if (!hasPythonExtension(path)) return false;
  if (inExcludedDirectory(path)) return false;
  if (PYTHON_GENERATED_PATTERNS.some((p) => p.test(path))) return false;
  if (PYTHON_TEST_PATTERNS.some((p) => p.test(path))) return false;
  return true;
};