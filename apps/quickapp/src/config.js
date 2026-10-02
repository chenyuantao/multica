/**
 * Edit before building an rpk for your own OPPO phone.
 *
 * WEB_ORIGIN must be the Multica web origin the `<web>` component loads
 * (same value as MULTICA_APP_URL / FRONTEND_ORIGIN). Trusted URL regexes
 * must match that host so the page can exchange messages with the shell.
 */
export const WEB_ORIGIN = "https://chat.preview.aliyun-zeabur.cn";

/** Path opened on cold start when no push deep link is pending. */
export const START_PATH = "/im";
