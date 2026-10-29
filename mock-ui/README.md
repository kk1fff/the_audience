# Mock UI

Static design reference for the first release: a three-column desktop feed with navigation, a central timeline, and an friend list. On narrow screens, navigation collapses and the roster is hidden. The implemented mock is represented by the UI styles in `apps/web/app/style.css`; screenshots can be placed here during review.

## Agent activity for scheduled feed checks

`activity-feed-check.svg` is the proposed activity view for issue #1. Rename the page to **Agent activity** because it will include both notifications and scheduled feed checks. Keep entries grouped by post and label the source on each entry. A friend can have a missed or unselected notification entry followed by a separate feed check entry for the same post. Show when the post was found and the resulting decision; keep the existing expandable model request and memory details. Use the existing purple for notifications and green for feed checks, with text labels so color is not the only distinction.

## Narrow nested conversation

`narrow-thread.svg` is the proposed 554 × 702 feed view for issue #3. Indent the first reply level by 24 pixels and cap deeper replies at that same inset. Keep the parent relationship clear with a subtle vertical rail and a “Replying to [name]” cue; do not keep shifting each nested reply to the right. Give the reply input the available width, then place image attachment and Send on a separate row. The mock shows four reply levels without compressing the message text or input.

## Mobile activity with reactions first

`activity-reactions-mobile.svg` is the proposed 375 × 760 view for issue #6. Within each post, show reactions above no-action events in activity time order. Keep the source badge on each reaction so a feed check and a notification by the same friend remain separate records. Group missed, not selected, and pending events in an explicit **Other activity** disclosure with counts. Expanding it shows each event with its status and timing; each entry retains its own expandable diagnostic details. An event with no model attempt should say so in one short line and omit empty Before/After memory panels. A reaction with an attempt keeps model request, result, and memory details available on demand.

## Post context in Agent activity

`activity-post-preview-mobile.svg` and `activity-post-preview-desktop.svg` are the proposed issue #9 views. Replace the standalone “Post #N” heading with a compact preview card. Keep the number as a secondary label, then show a short excerpt of the post with whitespace normalized and at most two lines. Clamp long unbroken strings within the card rather than letting them widen the page. Show a small first-image thumbnail on the right for text-plus-image or image-only posts; give the image an accessible label such as “Image from post #N.” For an image-only post, use “Photo post” as the text cue. If the image cannot load, show a bounded “Image unavailable” fallback. If post metadata is unavailable, show “Post unavailable” and keep its activity records below. On mobile, keep the preview at roughly one reaction card's height or less so reactions remain high in the viewport. Preserve issue #6's reaction-first order and expandable Other activity summary.
