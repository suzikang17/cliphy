import { useLocalSearchParams } from "expo-router";
import { ProjectDetail } from "../../../components/coach/ProjectDetail";

/** One project, as its own page. The same contents show inline on the Projects screen. */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProjectDetail id={id} />;
}
