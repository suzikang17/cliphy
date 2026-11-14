import type { ChatLink } from "@cliphy/shared";

/** Where a link from the bot leads. */
export function linkPath(link: ChatLink): string {
  switch (link.type) {
    case "request":
      return `/coach/request/${link.id}`;
    case "task":
      return `/coach/task/${link.id}`;
    case "project":
      return `/coach/project/${link.id}`;
    case "upnext":
      return "/coach/upnext";
    case "setup":
      return "/coach/setup";
    case "camera":
      return "/coach/camera";
  }
}
