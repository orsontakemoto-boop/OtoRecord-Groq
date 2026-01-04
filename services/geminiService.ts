
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ConsultationSummary } from "../types";

export async function processConsultationAudio(audioBase64: string, mimeType: string): Promise<ConsultationSummary> {
  // Initialize exclusively with process.env.API_KEY directly
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemInstruction = `
    Você é um assistente médico especializado em Otorrinolaringologia. 
    Analise o áudio da consulta e gere um resumo estruturado para o prontuário médico.
    O resumo deve ser conciso, profissional e usar terminologia médica adequada em português.
    
    Estruture a resposta nos seguintes campos:
    - pacienteInfo: Identificação básica se mencionada.
    - queixaPrincipal: O motivo principal da consulta.
    - hda: História da Doença Atual.
    - exameFisico: Achados do exame físico mencionados.
    - hipoteseDiagnostica: Suspeitas diagnósticas baseadas no relato.
    - conduta: Orientações, prescrições e pedidos de exames.
  `;

  try {
    const timeoutLimit = 95000; 
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error("TIMEOUT")), timeoutLimit)
    );

    const apiCall = ai.models.generateContent({
      // Use gemini-3-pro-preview for complex reasoning tasks like medical summarization
      model: 'gemini-3-pro-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: audioBase64
            }
          },
          { text: "Analise o áudio desta consulta médica e preencha o prontuário estruturado conforme as instruções." }
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

    // Access the .text property directly
    const resultText = response.text;
    if (!resultText) throw new Error("A IA não retornou conteúdo.");
    
    return JSON.parse(resultText) as ConsultationSummary;

  } catch (error: any) {
    console.error("Erro Gemini:", error);
    const msg = error.message || "";
    if (msg.includes("429")) throw new Error("Limite de cota excedido. Tente novamente em alguns segundos.");
    if (msg.includes("401")) throw new Error("Chave de API inválida. Por favor, selecione sua chave novamente nas configurações.");
    throw new Error(msg || "Erro ao processar áudio.");
  }
}
