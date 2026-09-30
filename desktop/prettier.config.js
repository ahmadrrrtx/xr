/** @type {import("prettier").Config} */
const config = {
  tabWidth: 2,
  singleQuote: true,
  semi: true,
  trailingComma: 'es5',
  arrowParens: 'always',
  plugins: ['prettier-plugin-tailwindcss'],
};

export default config;
