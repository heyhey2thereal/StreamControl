// Vite transforme un import d'image en URL de fichier. Ce fichier n'a ni
// import ni export : les declarations sont donc globales, comme TypeScript
// l'exige pour un module ambiant.
declare module '*.png' {
  const url: string;
  export default url;
}
