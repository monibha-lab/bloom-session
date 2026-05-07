export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_url: string | null
          blue_flames: number
          created_at: string
          current_streak: number
          id: string
          last_session_date: string | null
          sessions_completed: number
          stars: number
          total_seconds: number
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          blue_flames?: number
          created_at?: string
          current_streak?: number
          id: string
          last_session_date?: string | null
          sessions_completed?: number
          stars?: number
          total_seconds?: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          blue_flames?: number
          created_at?: string
          current_streak?: number
          id?: string
          last_session_date?: string | null
          sessions_completed?: number
          stars?: number
          total_seconds?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      session_members: {
        Row: {
          id: string
          joined_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_members_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_results: {
        Row: {
          created_at: string
          duration_seconds: number
          flames_delta: number
          id: string
          session_id: string
          stars_delta: number
          succeeded: boolean
          tasks_completed: number
          tasks_total: number
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number
          flames_delta?: number
          id?: string
          session_id: string
          stars_delta?: number
          succeeded?: boolean
          tasks_completed?: number
          tasks_total?: number
          user_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number
          flames_delta?: number
          id?: string
          session_id?: string
          stars_delta?: number
          succeeded?: boolean
          tasks_completed?: number
          tasks_total?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_results_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          code: string | null
          code_expires_at: string | null
          created_at: string
          duration_seconds: number
          ended_at: string | null
          host_id: string
          id: string
          mode: string
          started_at: string | null
          status: string
          template_name: string | null
          template_url: string | null
          timer_type: string
        }
        Insert: {
          code?: string | null
          code_expires_at?: string | null
          created_at?: string
          duration_seconds?: number
          ended_at?: string | null
          host_id: string
          id?: string
          mode?: string
          started_at?: string | null
          status?: string
          template_name?: string | null
          template_url?: string | null
          timer_type?: string
        }
        Update: {
          code?: string | null
          code_expires_at?: string | null
          created_at?: string
          duration_seconds?: number
          ended_at?: string | null
          host_id?: string
          id?: string
          mode?: string
          started_at?: string | null
          status?: string
          template_name?: string | null
          template_url?: string | null
          timer_type?: string
        }
        Relationships: []
      }
      study_logs: {
        Row: {
          created_at: string
          date: string
          duration_seconds: number
          id: string
          session_id: string | null
          succeeded: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          duration_seconds?: number
          id?: string
          session_id?: string | null
          succeeded?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          duration_seconds?: number
          id?: string
          session_id?: string | null
          succeeded?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          position: number
          session_id: string
          title: string
          user_id: string
          visibility: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          position?: number
          session_id: string
          title: string
          user_id: string
          visibility?: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          position?: number
          session_id?: string
          title?: string
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
