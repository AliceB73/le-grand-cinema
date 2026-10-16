export function redirectToCheckout(
  url: string,
  location: Pick<Location, 'assign'> = window.location,
) {
  location.assign(url);
}
