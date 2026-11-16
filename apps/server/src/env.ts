export type AppEnv = {
  Variables: {
    userId: string;
    userEmail: string;
    authMethod: "jwt" | "api_key";
    /** What an API key is limited to. Null for a signed-in user and for an unlimited key. */
    keyScope: "runner" | null;
  };
};
