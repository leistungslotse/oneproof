export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 150],
    'body-max-line-length': [0, 'always', 200],
    'subject-case': [0],
  },
}
