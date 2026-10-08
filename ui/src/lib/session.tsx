import { createContext, useContext, useState, type ReactNode } from "react";

export interface Persona { id: string; name: string; label: string; role: string }
export interface Channel { id: string; label: string }

const DEFAULT_PERSONA: Persona = { id: "priya", name: "Priya", label: "Pharmacy advocate", role: "pharmacy_advocate" };
export const PERSONAS: Persona[] = [
  { id: "priya", name: "Priya", label: "Pharmacy advocate", role: "pharmacy_advocate" },
  { id: "marcus", name: "Marcus", label: "Insurance advocate", role: "insurance_advocate" },
  { id: "eleanor", name: "Eleanor", label: "Member chat", role: "member_chat" },
];

export const CHANNELS: Channel[] = [
  { id: "advocate_view", label: "Advocate view" },
  { id: "member_chat", label: "Member chat" },
  { id: "voice", label: "Voice" },
];

export const MEMBER_CHANNELS = ["member_chat", "voice"];

interface SessionState {
  persona: Persona;
  channel: string;
  setPersona: (id: string) => void;
  setChannel: (id: string) => void;
  allowedChannels: Channel[];
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [persona, setP] = useState<Persona>(DEFAULT_PERSONA);
  const [channel, setC] = useState("advocate_view");
  const isMember = persona.role === "member_chat";
  const allowedChannels = isMember ? CHANNELS.filter((c) => MEMBER_CHANNELS.includes(c.id)) : CHANNELS;

  const setPersona = (id: string) => {
    const p = PERSONAS.find((x) => x.id === id) ?? DEFAULT_PERSONA;
    setP(p);
    if (p.role === "member_chat" && !MEMBER_CHANNELS.includes(channel)) setC("member_chat");
  };
  const setChannel = (id: string) => {
    if (allowedChannels.some((c) => c.id === id)) setC(id);
  };

  return (
    <SessionContext.Provider value={{ persona, channel, setPersona, setChannel, allowedChannels }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
