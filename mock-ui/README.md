# Mock UI

Static design reference for the first release: a three-column desktop feed with navigation, a central timeline, and an friend list. On narrow screens, navigation collapses and the roster is hidden. The implemented mock is represented by the UI styles in `apps/web/app/style.css`; screenshots can be placed here during review.

## Agent activity for scheduled feed checks

`activity-feed-check.svg` is the proposed activity view for issue #1. Rename the page to **Agent activity** because it will include both notifications and scheduled feed checks. Keep entries grouped by post and label the source on each entry. A friend can have a missed or unselected notification entry followed by a separate feed check entry for the same post. Show when the post was found and the resulting decision; keep the existing expandable model request and memory details. Use the existing purple for notifications and green for feed checks, with text labels so color is not the only distinction.

## Narrow nested conversation

`narrow-thread.svg` is the proposed 554 × 702 feed view for issue #3. Indent the first reply level by 24 pixels and cap deeper replies at that same inset. Keep the parent relationship clear with a subtle vertical rail and a “Replying to [name]” cue; do not keep shifting each nested reply to the right. Give the reply input the available width, then place image attachment and Send on a separate row. The mock shows four reply levels without compressing the message text or input.
