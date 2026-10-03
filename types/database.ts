export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type StudySessionRow = {
  id: string;
  public_session_id: string;
  participant_code: string;
  participant_access_token_hash: string;
  trace_enabled: boolean;
  study_status: string;
  session_status: string;
  session_data: Json;
  revision: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  assignment_method: string | null;
  assignment_timestamp: string | null;
  assignment_block_id: string | null;
  assignment_position: number | null;
  assignment_sequence: number | null;
};

export type StudySessionInsert = Omit<StudySessionRow, "id" | "revision" | "created_at" | "updated_at" | "completed_at" | "assignment_method" | "assignment_timestamp" | "assignment_block_id" | "assignment_position" | "assignment_sequence"> & {
  id?: string;
  revision?: number;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  assignment_method?: string | null;
  assignment_timestamp?: string | null;
  assignment_block_id?: string | null;
  assignment_position?: number | null;
  assignment_sequence?: number | null;
};

export type StudySessionUpdate = Partial<Omit<StudySessionRow, "id" | "created_at" | "updated_at">>;

export type GeneratedImageRow = {
  id: string;
  session_id: string;
  existing_image_id: string;
  request_id: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  sha256_checksum: string | null;
  metadata: Json;
  created_at: string;
};

export type GeneratedImageInsert = Omit<GeneratedImageRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type GeneratedImageUpdate = Partial<Omit<GeneratedImageRow, "id" | "session_id" | "created_at">>;

export type CalibrationWorkspaceRow = {
  id: string;
  data: Json;
  revision: number;
  updated_at: string;
};

export type CalibrationWorkspaceInsert = Omit<CalibrationWorkspaceRow, "revision" | "updated_at"> & {
  revision?: number;
  updated_at?: string;
};

export type CalibrationWorkspaceUpdate = Partial<Omit<CalibrationWorkspaceRow, "id" | "updated_at">>;

export type ConditionAssignmentBlockRow = {
  study_status: string;
  block_number: number;
  allocation_order: string;
  allocated_count: number;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      study_sessions: {
        Row: StudySessionRow;
        Insert: StudySessionInsert;
        Update: StudySessionUpdate;
        Relationships: [];
      };
      generated_images: {
        Row: GeneratedImageRow;
        Insert: GeneratedImageInsert;
        Update: GeneratedImageUpdate;
        Relationships: [{
          foreignKeyName: "generated_images_session_id_fkey";
          columns: ["session_id"];
          isOneToOne: false;
          referencedRelation: "study_sessions";
          referencedColumns: ["id"];
        }];
      };
      calibration_workspaces: {
        Row: CalibrationWorkspaceRow;
        Insert: CalibrationWorkspaceInsert;
        Update: CalibrationWorkspaceUpdate;
        Relationships: [];
      };
      condition_assignment_blocks: {
        Row: ConditionAssignmentBlockRow;
        Insert: ConditionAssignmentBlockRow;
        Update: Partial<ConditionAssignmentBlockRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_study_session_with_assignment: {
        Args: {
          p_public_session_id: string;
          p_participant_code: string;
          p_participant_access_token_hash: string;
          p_study_status: string;
          p_session_status: string;
          p_session_data: Json;
          p_manual_condition?: string | null;
        };
        Returns: StudySessionRow;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
