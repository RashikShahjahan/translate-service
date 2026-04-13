export type ProjectSummary = {
  id: number;
  name: string;
  createdAt: string;
  sourceLanguage: string;
  targetLanguage: string;
  totalDocuments: number;
  queuedDocuments: number;
  processingDocuments: number;
  completedDocuments: number;
  erroredDocuments: number;
};

export type DocumentRow = {
  id: number;
  sourceName: string;
  sourceType: string;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  nextAttemptAt: string | null;
  leasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentListResponse = {
  documents: DocumentRow[];
  page: number;
  pageSize: number;
  totalCount: number;
};

export type DocumentDetail = {
  id: number;
  projectName: string;
  sourceName: string;
  sourceType: string;
  mimeType: string | null;
  sourceText: string | null;
  ocrText: string | null;
  translatedText: string | null;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  nextAttemptAt: string | null;
  leasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkerScheduleStatus = {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  startTime: string;
  endTime: string;
  plistPath: string;
};
