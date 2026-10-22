import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Tailwind CSS v4 は Vite プラグインとして組み込む
export default defineConfig({
  plugins: [tailwindcss()],
});
