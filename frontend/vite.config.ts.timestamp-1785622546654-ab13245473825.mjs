// vite.config.ts
import { defineConfig } from "file:///mnt/c/Users/User/Desktop/projects/Backgammon%20Game/frontend/node_modules/.pnpm/vite@5.4.21_lightningcss@1.32.0/node_modules/vite/dist/node/index.js";
import react from "file:///mnt/c/Users/User/Desktop/projects/Backgammon%20Game/frontend/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_lightningcss@1.32.0_/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///mnt/c/Users/User/Desktop/projects/Backgammon%20Game/frontend/node_modules/.pnpm/@tailwindcss+vite@4.3.3_vite@5.4.21_lightningcss@1.32.0_/node_modules/@tailwindcss/vite/dist/index.mjs";
import path from "path";
import { fileURLToPath } from "url";
var __vite_injected_original_import_meta_url = "file:///mnt/c/Users/User/Desktop/projects/Backgammon%20Game/frontend/vite.config.ts";
var __dirname = fileURLToPath(new URL(".", __vite_injected_original_import_meta_url));
var srcRoot = path.resolve(__dirname, "./src");
var vite_config_default = defineConfig({
  base: "/backgammon/",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": srcRoot
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      alias: {
        "@": srcRoot
      }
    }
  },
  server: {
    port: 5173,
    open: true,
    allowedHosts: ["morphotonemic-compellably-roselee.ngrok-free.dev"],
    proxy: {
      "/backgammon/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path2) => path2.replace(/^\/backgammon/, "")
      },
      "/backgammon/ws": {
        target: "ws://localhost:8000",
        ws: true,
        rewrite: (path2) => path2.replace(/^\/backgammon/, "")
      }
    },
    watch: {
      usePolling: true
    }
  },
  build: {
    outDir: "dist",
    sourcemap: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvbW50L2MvVXNlcnMvVXNlci9EZXNrdG9wL3Byb2plY3RzL0JhY2tnYW1tb24gR2FtZS9mcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL21udC9jL1VzZXJzL1VzZXIvRGVza3RvcC9wcm9qZWN0cy9CYWNrZ2FtbW9uIEdhbWUvZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL21udC9jL1VzZXJzL1VzZXIvRGVza3RvcC9wcm9qZWN0cy9CYWNrZ2FtbW9uJTIwR2FtZS9mcm9udGVuZC92aXRlLmNvbmZpZy50c1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XG5pbXBvcnQgdGFpbHdpbmRjc3MgZnJvbSBcIkB0YWlsd2luZGNzcy92aXRlXCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcblxuY29uc3QgX19kaXJuYW1lID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLlwiLCBpbXBvcnQubWV0YS51cmwpKTtcbmNvbnN0IHNyY1Jvb3QgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjXCIpO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBiYXNlOiBcIi9iYWNrZ2FtbW9uL1wiLFxuICBwbHVnaW5zOiBbdGFpbHdpbmRjc3MoKSwgcmVhY3QoKV0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHNyY1Jvb3QsXG4gICAgfSxcbiAgfSxcbiAgb3B0aW1pemVEZXBzOiB7XG4gICAgZXNidWlsZE9wdGlvbnM6IHtcbiAgICAgIGFsaWFzOiB7XG4gICAgICAgIFwiQFwiOiBzcmNSb290LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTczLFxuICAgIG9wZW46IHRydWUsXG4gICAgYWxsb3dlZEhvc3RzOiBbXCJtb3JwaG90b25lbWljLWNvbXBlbGxhYmx5LXJvc2VsZWUubmdyb2stZnJlZS5kZXZcIl0sXG4gICAgcHJveHk6IHtcbiAgICAgIFwiL2JhY2tnYW1tb24vYXBpXCI6IHtcbiAgICAgICAgdGFyZ2V0OiBcImh0dHA6Ly9sb2NhbGhvc3Q6ODAwMFwiLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLnJlcGxhY2UoL15cXC9iYWNrZ2FtbW9uLywgXCJcIiksXG4gICAgICB9LFxuICAgICAgXCIvYmFja2dhbW1vbi93c1wiOiB7XG4gICAgICAgIHRhcmdldDogXCJ3czovL2xvY2FsaG9zdDo4MDAwXCIsXG4gICAgICAgIHdzOiB0cnVlLFxuICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvYmFja2dhbW1vbi8sIFwiXCIpLFxuICAgICAgfSxcbiAgICB9LFxuICAgIHdhdGNoOiB7XG4gICAgICB1c2VQb2xsaW5nOiB0cnVlLFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgb3V0RGlyOiBcImRpc3RcIixcbiAgICBzb3VyY2VtYXA6IHRydWUsXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBcVcsU0FBUyxvQkFBb0I7QUFDbFksT0FBTyxXQUFXO0FBQ2xCLE9BQU8saUJBQWlCO0FBQ3hCLE9BQU8sVUFBVTtBQUNqQixTQUFTLHFCQUFxQjtBQUpnTSxJQUFNLDJDQUEyQztBQU0vUSxJQUFNLFlBQVksY0FBYyxJQUFJLElBQUksS0FBSyx3Q0FBZSxDQUFDO0FBQzdELElBQU0sVUFBVSxLQUFLLFFBQVEsV0FBVyxPQUFPO0FBRS9DLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLE1BQU07QUFBQSxFQUNOLFNBQVMsQ0FBQyxZQUFZLEdBQUcsTUFBTSxDQUFDO0FBQUEsRUFDaEMsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSztBQUFBLElBQ1A7QUFBQSxFQUNGO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixnQkFBZ0I7QUFBQSxNQUNkLE9BQU87QUFBQSxRQUNMLEtBQUs7QUFBQSxNQUNQO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLGNBQWMsQ0FBQyxrREFBa0Q7QUFBQSxJQUNqRSxPQUFPO0FBQUEsTUFDTCxtQkFBbUI7QUFBQSxRQUNqQixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsUUFDZCxTQUFTLENBQUNBLFVBQVNBLE1BQUssUUFBUSxpQkFBaUIsRUFBRTtBQUFBLE1BQ3JEO0FBQUEsTUFDQSxrQkFBa0I7QUFBQSxRQUNoQixRQUFRO0FBQUEsUUFDUixJQUFJO0FBQUEsUUFDSixTQUFTLENBQUNBLFVBQVNBLE1BQUssUUFBUSxpQkFBaUIsRUFBRTtBQUFBLE1BQ3JEO0FBQUEsSUFDRjtBQUFBLElBQ0EsT0FBTztBQUFBLE1BQ0wsWUFBWTtBQUFBLElBQ2Q7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixXQUFXO0FBQUEsRUFDYjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbInBhdGgiXQp9Cg==
