export type AppEnv = {
  Variables: {
    userId: string;
    userEmail: string;
    authMethod: "jwt" | "api_key";
  };
};
