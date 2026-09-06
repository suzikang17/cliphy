import { PinsBoard } from "../../components/pins/PinsBoard";

export function App() {
  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PinsBoard columns={4} />
    </main>
  );
}
