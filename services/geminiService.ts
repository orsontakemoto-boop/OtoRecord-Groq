
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ConsultationSummary } from "../types";

// Função para obter a chave da API (Prioriza localStorage para BYOK)
const getApiKey = () => {
  try {
    return localStorage.getItem('GEMINI_API_KEY') || process.env.API_KEY || "";
  } catch (e) {
    return process.env.API_KEY || "";
  }
};

export async function processConsultationAudio(audioBase64: string, mimeType: string): Promise<ConsultationSummary> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Chave API não configurada. Por favor, acesse Configurações.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `
    Você é um assistente médico especializado em Otorrinolaringologia. 
    Analise o áudio da consulta e gere um resumo estruturado para o prontuário médico.
    O resumo deve ser conciso, profissional e usar terminologia médica adequada em português.
    
    Estruture a resposta nos seguintes campos:
    - pacienteInfo: Identificação básica se mencionada (nome, idade, etc).
    - queixaPrincipal: O motivo principal da consulta.
    - hda: História da Doença Atual (tempo de evolução, sintomas associados, fatores de melhora/piora).
    - exameFisico: Achados do exame físico mencionados (otoscopia, rinoscopia, oroscopia).
    - hipoteseDiagnostica: Suspeitas diagnósticas baseadas no relato.
    - conduta: Orientações, prescrições e pedidos de exames.
  `;

  try {
    const timeoutLimit = 95000; 
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error("TIMEOUT")), timeoutLimit)
    );

    const apiCall = ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: audioBase64
            }
          },
          { text: "Por favor, analise este áudio de consulta médica e extraia as informações para o prontuário estruturado." }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pacienteInfo: { type: Type.STRING },
            queixaPrincipal: { type: Type.STRING },
            hda: { type: Type.STRING },
            exameFisico: { type: Type.STRING },
            hipoteseDiagnostica: { type: Type.STRING },
            conduta: { type: Type.STRING }
          },
          propertyOrdering: ["pacienteInfo", "queixaPrincipal", "hda", "exameFisico", "hipoteseDiagnostica", "conduta"],
        }
      }
    });

    const response = await Promise.race([apiCall, timeoutPromise]) as GenerateContentResponse;

    const resultText = response.text;
    if (!resultText) throw new Error("A IA retornou uma resposta vazia.");
    
    return JSON.parse(resultText) as ConsultationSummary;

  } catch (error: any) {
    console.error("Erro detalhado no Gemini:", error);

    if (error.message === "TIMEOUT") {
      throw new Error("O processamento demorou muito. Áudios muito longos podem exceder o limite da API.");
    }
    
    const msg = error.message || JSON.stringify(error);

    if (msg.includes("401") || msg.includes("invalid key") || msg.includes("API_KEY_INVALID")) {
      throw new Error("Chave de API inválida ou expirada. Verifique suas configurações.");
    }

    if (msg.includes("429") || msg.includes("Quota exceeded")) {
      throw new Error("Limite de cota atingido na sua chave API gratuita. Tente novamente em instantes.");
    }

    throw new Error(`Falha no processamento: ${msg.substring(0, 100)}...`);
  }
}
