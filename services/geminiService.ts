
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ConsultationSummary } from "../types";

export async function processConsultationAudio(audioBase64: string, mimeType: string): Promise<ConsultationSummary> {
  // Always use the process.env.API_KEY directly as required by guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Use systemInstruction for persona and structural requirements
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
    // Calling generateContent with the model name and required parameters
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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
            pacienteInfo: { 
              type: Type.STRING,
              description: 'Identificação básica do paciente se disponível.'
            },
            queixaPrincipal: { 
              type: Type.STRING,
              description: 'O motivo principal da consulta.'
            },
            hda: { 
              type: Type.STRING,
              description: 'História da Doença Atual.'
            },
            exameFisico: { 
              type: Type.STRING,
              description: 'Achados do exame físico.'
            },
            hipoteseDiagnostica: { 
              type: Type.STRING,
              description: 'Suspeitas ou hipóteses diagnósticas.'
            },
            conduta: { 
              type: Type.STRING,
              description: 'Orientações e planos de conduta.'
            }
          },
          propertyOrdering: ["pacienteInfo", "queixaPrincipal", "hda", "exameFisico", "hipoteseDiagnostica", "conduta"],
        }
      }
    });

    // Accessing .text as a property as per @google/genai guidelines
    const resultText = response.text;
    if (!resultText) throw new Error("Não foi possível gerar o resumo.");
    
    return JSON.parse(resultText) as ConsultationSummary;
  } catch (error) {
    console.error("Erro no processamento Gemini:", error);
    throw error;
  }
}
