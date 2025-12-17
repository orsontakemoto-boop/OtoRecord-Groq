
export interface ConsultationSummary {
  pacienteInfo: string;
  queixaPrincipal: string;
  hda: string;
  exameFisico: string;
  hipoteseDiagnostica: string;
  conduta: string;
}

export enum AppState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PROCESSING = 'PROCESSING',
  RESULT = 'RESULT',
  ERROR = 'ERROR'
}
