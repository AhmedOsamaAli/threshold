import { useRef } from "react";
import { REPO_URL } from "../../lib/product";
import { CopyButton } from "../CopyButton";

/** The limits token for another assistant, an MCP client: the same limits, checked by the same server. Closed until the
 * person opens it, since the token is theirs. */
export function AssistantToken({ token }: { token: string }) {
  const valueRef = useRef<HTMLElement>(null);
  return (
    <details className="ask-token">
      <summary className="mono">Use these limits with another assistant</summary>
      <p>
        An MCP client can prepare pledges for you inside these same limits, through the{" "}
        <a className="text-link" href={`${REPO_URL}/tree/main/mcp_server`} target="_blank" rel="noopener noreferrer">
          Threshold MCP server
        </a>
        . Paste this as <code>THRESHOLD_LIMITS</code> in its settings. It only limits what an assistant may prepare: it cannot
        approve a pledge, and only you can, in PayPal.
      </p>
      <div className="ask-token-row">
        <code className="ask-token-value mono" ref={valueRef} tabIndex={0}>
          {token}
        </code>
        <CopyButton text={token} what="your limits token" target={valueRef} />
      </div>
    </details>
  );
}
