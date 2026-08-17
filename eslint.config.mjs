import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["out/**", "node_modules/**"],
	},
	{
		files: ["src/**/*.ts"],
		extends: [eslint.configs.recommended, tseslint.configs.recommended],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": "warn",
			"prefer-const": "off",
		},
	}
);
