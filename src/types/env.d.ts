declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DISCORD_TOKEN: string;
      GEMINI_API_KEY: string;
    }
  }
}

export {}; 