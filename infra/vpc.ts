export const vpc = new sst.aws.Vpc("Vpc", {
  nat: "ec2",
});
