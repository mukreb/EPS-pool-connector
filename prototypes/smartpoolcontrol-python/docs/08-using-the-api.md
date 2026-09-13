# 9.6 Using the API

To use the API effectively, developers should consider the following:

- Ensure all requests are authenticated using the `api_key`.
- Utilize the appropriate HTTP methods for your request:
  - `GET` for retrieving data,
  - `POST` for creating new entries, and
  - `PUT` for updating existing data.
- Familiarize yourself with the rate limits and ensure your application respects
  these limits to prevent access issues.
- Minimum and maximum values specified might not align with those actually
  permitted by the pool system.
  - It's important to ensure that the **start time is never set later than the
    end time** in any schedule. Although the system might currently accept this,
    it will lead to issues in operation.
  - Entering values beyond the allowed range, whether higher or lower, can
    result in problematic behavior.

> Future updates will include added safeguards in the database to prevent these
> issues.

# 9.7 Conclusion

The PoolBuilder Public API is designed to facilitate robust and secure
management of pool data. By adhering to the guidelines provided in this
documentation, developers can optimize their integration and utilize the full
capabilities of the API to enhance their applications.

For further assistance or to report issues, please contact the PoolBuilder API
support team by emailing [support@epsbv.eu](mailto:support@epsbv.eu).

This documentation aims to ensure that you have all the necessary information to
begin working effectively with the PoolBuilder API. **Happy coding!**
